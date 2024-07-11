import { expect, use } from "chai"
import { AbstractContract, BN, DateTime, FUEL_NETWORK_URL, Provider, Wallet, WalletUnlocked } from "fuels"
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
import { deploy, getBalance, getValue, getValStr, formatObj } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd, toUsdBN } from "../../utils/units"
import { ZERO_B256 } from "../../utils/constants"
import { getAssetId, toAsset, transfer } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BigNumber } from "ethers"
import { getBnbConfig, getBtcConfig, getDaiConfig, getEthConfig, validateVaultBalance } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"

use(useChai)

describe("Vault.withdrawCollateral", function () {
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

    it("withdraw collateral", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
            .addContracts(attachedContracts)
            .call()

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await BTCPricefeed.functions.set_latest_answer(toPrice(45100)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(46100)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(47100)).call()

        let leverage = await getValStr(
            vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
        )
        expect(leverage).eq("90817") // ~9X leverage

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BTC),
                toAsset(BTC),
                toUsd(3),
                toUsd(50),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        leverage = await getValStr(
            vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
        )
        expect(leverage).eq("57887") // ~5.8X leverage

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.91 - 3)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(asStr((225000 / 90) * 40)) // reserveAmount, 0.00225 * 40,000 => 90
        expect(position[5].value).eq(toUsd(5)) // pnl
        expect(position[6]).eq(true)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 106)) // 0.00000106 * 45100 => ~0.05 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr((225000 / 90) * 40))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(33.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 16878 - 106 - 1 - 219))
        expect(await getBalance(user2, BTC)).eq("16878") // 0.00016878 * 47100 => 7.949538 USD

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    toUsd(3),
                    0,
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BTC),
                toAsset(BTC),
                toUsd(1),
                0,
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.91 - 3 - 1)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(asStr((225000 / 90) * 40)) // reserveAmount, 0.00225 * 40,000 => 90
        expect(position[5].value).eq(toUsd(5)) // pnl
        expect(position[6]).eq(true)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 106)) // 0.00000106 * 45100 => ~0.05 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr((225000 / 90) * 40))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(34.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr(274250 - 16878 - 106 - 1 - 2123 - 219),
        ) // 0.00002123 * 47100 => 1 USD
        expect(await getBalance(user2, BTC)).eq(asStr(16878 + 2123))
    })

    it("withdraw during cooldown duration", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
            .addContracts(attachedContracts)
            .call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(45100)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(46100)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(47100)).call()

        // it's okay to withdraw AND decrease size with at least same proportion (e.g. if leverage is decreased or the same)
        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BTC),
                toAsset(BTC),
                toUsd(1),
                toUsd(10),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        // it's also okay to fully close position
        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BTC),
                toAsset(BTC),
                position[1],
                position[0],
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(30), true)
            .addContracts(attachedContracts)
            .call()
    })

    it("withdraw collateral long", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()

        await BNB.functions.mint(contrToAccount(vault), expandDecimals(10, 8)).call()
        await vault.functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("498500000000") // 4985
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("498500000000") // 4985

        await BNB.functions.mint(contrToAccount(vault), expandDecimals(1, 8)).call()
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(2000), true)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("498500000000") // 4985
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("498500000000") // 4985

        await BNBPricefeed.functions.set_latest_answer(toPrice(750)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(750)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(750)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("672650000000") // 6726.5
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("672650000000") // 6726.5

        await BNB.functions.mint(contrToAccount(vault), expandDecimals(1, 8)).call()
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(0), true)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("672650000000") // 6726.5
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("672650000000") // 6726.5

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BNB),
                toAsset(BNB),
                toUsd(500),
                toUsd(0),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("672650000500") // 6726.5000000000000005
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("672650000500") // 6726.5000000000000005

        await BNBPricefeed.functions.set_latest_answer(toPrice(400)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(400)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(400)).call()

        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("417173333600") // 4171.7333333333333336
        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("417173333600") // 4171.7333333333333336

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BNB),
                toAsset(BNB),
                toUsd(250),
                toUsd(0),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("417173333600") // 4171.7333333333333336
        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("417173333600") // 4171.7333333333333336

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BNB),
                toAsset(BNB),
                toUsd(0),
                toUsd(250),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("417173333600") // 4171.7333333333333336
        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("417173333600") // 4171.7333333333333336
    })

    it("withdraw collateral short", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()

        await DAI.functions.mint(contrToAccount(vault), expandDecimals(8000, 8)).call()
        await vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("797600000000") // 7976
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("797600000000") // 7976

        await DAI.functions.mint(contrToAccount(vault), expandDecimals(500, 8)).call()
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BNB), toUsd(2000), false)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("797600000000") // 7976
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("797600000000") // 7976

        await BNBPricefeed.functions.set_latest_answer(toPrice(525)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(525)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(525)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("807600000000") // 8076
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("807600000000") // 8076

        await DAI.functions.mint(contrToAccount(vault), expandDecimals(500, 8)).call()
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BNB), toUsd(0), false)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("807600000000") // 8076
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("807600000000") // 8076

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(DAI),
                toAsset(BNB),
                toUsd(500),
                toUsd(0),
                false,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("807600000000") // 8076
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("807600000000") // 8076

        await BNBPricefeed.functions.set_latest_answer(toPrice(475)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(475)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(475)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("787600000000") // 7876
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("787600000000") // 7876

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(DAI),
                toAsset(BNB),
                toUsd(0),
                toUsd(500),
                false,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("787600000000") // 7876
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("787600000000") // 7876
    })
})
