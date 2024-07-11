import { expect, use } from "chai"
import { AbstractContract, FUEL_NETWORK_URL, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    FungibleAbi,
    RlpAbi,
    RlpManagerAbi,
    PricefeedAbi,
    RouterAbi,
    TimeDistributorAbi,
    RusdAbi,
    UtilsAbi,
    VaultAbi,
    VaultPricefeedAbi,
    VaultStorageAbi,
    VaultUtilsAbi,
    YieldTrackerAbi,
} from "../../../types"
import { deploy, formatObj, getValStr, getValue } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd, toUsdBN } from "../../utils/units"
import { ZERO_B256 } from "../../utils/constants"
import { getAssetId, toAsset, transfer } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BigNumber } from "ethers"
import { getBnbConfig, getBtcConfig, getDaiConfig, getEthConfig, validateVaultBalance } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"

use(useChai)

describe("Vault.depositCollateral", () => {
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let utils: UtilsAbi
    let BNB: FungibleAbi
    let BNBPricefeed: PricefeedAbi
    let DAI: FungibleAbi
    let DAIPricefeed: PricefeedAbi
    let BTC: FungibleAbi
    let BTCPricefeed: PricefeedAbi
    let vault: VaultAbi
    let vaultStorage: VaultStorageAbi
    let vaultUtils: VaultUtilsAbi
    let rusd: RusdAbi
    let router: RouterAbi
    let vaultPricefeed: VaultPricefeedAbi
    let timeDistributor: TimeDistributorAbi
    let yieldTracker: YieldTrackerAbi
    let rlp: RlpAbi
    let rlpManager: RlpManagerAbi

    beforeEach(async () => {
        const localProvider = await Provider.create(FUEL_NETWORK_URL)

        const wallets = WALLETS.map((k) => Wallet.fromPrivateKey(k, localProvider))

        ;[deployer, user0, user1, user2, user3] = wallets

        /*
            NativeAsset + Pricefeed
        */
        BNB = (await deploy("Fungible", deployer)) as FungibleAbi
        BNBPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        DAI = (await deploy("Fungible", deployer)) as FungibleAbi
        DAIPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        BTC = (await deploy("Fungible", deployer)) as FungibleAbi
        BTCPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        await BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed").call()
        await DAIPricefeed.functions.initialize(addrToAccount(deployer), "DAI Pricefeed").call()
        await BTCPricefeed.functions.initialize(addrToAccount(deployer), "BTC Pricefeed").call()

        /*
            Vault + Router + RUSD
        */
        utils = await deploy("Utils", deployer)
        vault = await deploy("Vault", deployer)
        vaultStorage = await deploy("VaultStorage", deployer)
        vaultUtils = await deploy("VaultUtils", deployer)
        vaultPricefeed = await deploy("VaultPricefeed", deployer)
        rusd = await deploy("Rusd", deployer)
        router = await deploy("Router", deployer)
        timeDistributor = await deploy("TimeDistributor", deployer)
        yieldTracker = await deploy("YieldTracker", deployer)
        rlp = await deploy("Rlp", deployer)
        rlpManager = await deploy("RlpManager", deployer)

        attachedContracts = [vaultUtils, vaultStorage]

        await rusd.functions.initialize(toContract(vault)).call()
        await router.functions.initialize(toContract(vault), toContract(rusd), addrToAccount(deployer)).call()
        await vaultStorage.functions
            .initialize(
                addrToAccount(deployer),
                toContract(router),
                toAsset(rusd), // RUSD native asset
                toContract(rusd), // RUSD contract
                toContract(vaultPricefeed),
                toUsd(5), // liquidationFeeUsd
                600, // fundingRateFactor
                600, // stableFundingRateFactor
            )
            .call()
        await vaultUtils.functions.initialize(addrToAccount(deployer), toContract(vault), toContract(vaultStorage)).call()
        await vault.functions.initialize(addrToAccount(deployer), toContract(vaultUtils), toContract(vaultStorage)).call()
        await vaultStorage.functions.write_authorize(contrToAccount(vault), true).call()
        await vaultStorage.functions.write_authorize(contrToAccount(vaultUtils), true).call()
        await vaultUtils.functions.write_authorize(contrToAccount(vault), true).call()

        await yieldTracker.functions.initialize(toContract(rusd)).call()
        await yieldTracker.functions.set_time_distributor(toContract(timeDistributor)).call()
        await timeDistributor.functions.initialize().call()
        await timeDistributor.functions.set_distribution([contrToAccount(yieldTracker)], [1000], [toAsset(BNB)]).call()

        await BNB.functions.mint(contrToAccount(timeDistributor), 5000).call()
        await rusd.functions.set_yield_trackers([{ bits: contrToAccount(yieldTracker).value }]).call()

        await vaultPricefeed.functions.initialize(addrToAccount(deployer)).call()
        await vaultPricefeed.functions.set_asset_config(toAsset(BNB), toContract(BNBPricefeed), 8, false).call()
        await vaultPricefeed.functions.set_asset_config(toAsset(DAI), toContract(DAIPricefeed), 8, false).call()
        await vaultPricefeed.functions.set_asset_config(toAsset(BTC), toContract(BTCPricefeed), 8, false).call()

        await rlp.functions.initialize().call()
        await rlpManager.functions
            .initialize(
                toContract(vault),
                toContract(rusd),
                toContract(rlp),
                toContract(ZERO_B256),
                24 * 3600, // 24 hours
            )
            .call()
    })

    it("deposit collateral", async () => {
        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await transfer(BTC.as(user0), contrToAccount(vault), 117500 - 1) // 0.001174 BTC => 47

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(47), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("0")

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq("0")
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd("46.8584"))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("353") // (117500 - 1) * 0.3% => 353
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("4685840000") // (117500 - 1 - 353) * 40000
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(117500 - 1 - 353))

        await transfer(BTC.as(user0), contrToAccount(vault), 117500 - 1)
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(100), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd("93.7168"))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2)) // (117500 - 1) * 0.3% * 2
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr((117500 - 1 - 353) * 2))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(47), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInsufficientCollateralForFees")

        await transfer(BTC.as(user0), contrToAccount(vault), 22500)

        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9371680000") // 93.7168
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("9605972000") // 96.05972

        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(47), true)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9371820000") // 93.7182
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("9510998000") // 95.10998

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(256792 - 114))
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("117500")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(38.047))
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd(92.79)) // (256792 - 117500) sats * 40000 => 51.7968, 47 / 40000 * 41000 => ~45.8536

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(47)) // size
        expect(position[1]).eq(toUsd(8.953)) // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("117500") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2 + 114)) // fee is 0.047 USD => 0.00000114 BTC
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr((117500 - 1 - 353) * 2 + 22500 - 114),
        )

        let leverage = await getValStr(
            vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
        )
        expect(leverage).eq("52496") // ~5.2x

        await transfer(BTC.as(user0), contrToAccount(vault), 22500)

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9371820000") // 93.7182
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("9510998000") // 95.10998

        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, true)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9371820000") // 93.7182
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("9533498000") // 95.33498

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(47)) // size
        expect(position[1]).eq(toUsd(8.953 + 9)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("117500") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2 + 114)) // fee is 0.047 USD => 0.00000114 BTC
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr((117500 - 1 - 353) * 2 + 22500 + 22500 - 114),
        )

        leverage = await getValStr(
            vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
        )
        expect(leverage).eq("26179") // ~2.6x

        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(51000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10988600000") // 109.886
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("11150278000") // 111.50278

        await transfer(BTC.as(user0), contrToAccount(vault), 100)
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, true)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10988600000") // 109.886
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("11150378000") // 111.50378

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(47)) // size
        expect(position[1]).eq(toUsd(8.953 + 9 + 0.05)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("117500") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2 + 114)) // fee is 0.047 USD => 0.00000114 BTC
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr((117500 - 1 - 353) * 2 + 22500 + 22500 + 100 - 114),
        )

        leverage = await getValStr(
            vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
        )
        expect(leverage).eq("26106") // ~2.6x

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })
})
