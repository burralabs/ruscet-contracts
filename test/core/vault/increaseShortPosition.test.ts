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

describe("Vault.increaseShortPosition", function () {
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

    it("increasePosition short validations", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()
        await expect(
            vault
                .connect(user1)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), 0, false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInvalidMsgCaller")
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortCollateralAssetNotWhitelisted")
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortCollateralAssetMustBeStableAsset")

        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(DAI), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortIndexAssetMustNotBeStableAsset")

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortIndexAssetNotShortable")

        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions
            .set_asset_config(
                toAsset(BTC), // _token
                8, // _tokenDecimals
                10000, // _tokenWeight
                75, // _minProfitBps
                0, // _maxRusdAmount
                false, // _isStable
                false, // _isShortable
            )
            .call()

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortIndexAssetNotShortable")

        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInsufficientCollateralForFees")
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), 0, false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInvalidPositionSize")

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)).call()
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(9, 7))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInsufficientCollateralForFees")

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(4))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultLossesExceedCollateral")

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(6))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(8), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultSizeMustBeMoreThanCollateral")

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(600), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultMaxLeverageExceeded")

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")
    })

    it("increasePosition short", async () => {
        await vaultStorage.functions.set_max_global_short_size(toAsset(BTC), toUsd(300)).call()

        let globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("0")

        await vaultStorage.functions
            .set_fees(
                50, // _taxBasisPoints
                10, // _stableTaxBasisPoints
                4, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                0, // _minProfitTime
                false, // _hasDynamicFees
            )
            .call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(1000)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)).call()
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(500))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(99), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultSizeMustBeMoreThanCollateral")

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(501), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("0")

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(DAI)))).eq("0")
        await vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(DAI)))).eq(
            "499800000000000000000000000000000",
        )

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("20000000") // 0.2
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("49980000000") // 499.8
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("49980000000") // 499.8

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("49980000000")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("49980000000")

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(20))
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(501), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount
        expect(position[5].value).eq("0") // realisedPnl
        expect(position[6]).eq(true) // hasProfit
        expect(position[7]).eq("0") // lastIncreasedTime

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("49980000000")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(90))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(DAI)))).eq(
            "499800000000000000000000000000000",
        )

        let timestamp = await getValStr(utils.functions.get_timestamp())

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(19.91)) // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(90)) // reserveAmount
        expect(position[5].value).eq("0") // realisedPnl
        expect(position[6]).eq(true) // hasProfit
        let lastIncreasedTime = BigNumber.from(position[7])
        // timestamp is within a deviation of 2 (actually: 1), so account for that here
        expect(lastIncreasedTime.gte(BigNumber.from(timestamp).sub(2)) && lastIncreasedTime.lte(BigNumber.from(timestamp).add(2)))
            .to.be.true // lastIncreasedTime

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("29000000") // 0.29
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("49980000000") // 0.29
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("49980000000") // 499.8

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(90))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(2.25))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50205000000")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("49980000000")

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(2.25))

        await BTCPricefeed.functions.set_latest_answer(toPrice(42000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(42000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(42000)).call()

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(4.5))

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(4.5))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50430000000") // 499.8 + 4.5
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("50430000000") // 499.8 + 4.5

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(DAI),
                toAsset(BTC),
                toUsd(3),
                toUsd(50),
                false,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(14.41)) // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(40)) // reserveAmount
        expect(position[5].value).eq(toUsd(2.5)) // realisedPnl
        expect(position[6]).eq(false) // hasProfit
        expect(position[7]).eq(timestamp) // lastIncreasedTime

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(2))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("34000000") // 0.18
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("49980000000") // 499.8
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("50230000000") // 502.3

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(40))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(2))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50430000000") // 499.8 + 4.5
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("50430000000") // 499.8 + 4.5

        await DAI.functions.mint(contrToAccount(vault), expandDecimals(50)).call()
        await vault
            .connect(user1)
            .functions.increase_position(addrToAccount(user1), toAsset(DAI), toAsset(BTC), toUsd(200), false)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(240))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(
            "41652892561983471074380165289256198",
        )

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(2))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50430000000") // 502.3 + 2
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("50430000000") // 502.3 + 2

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(1))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user1), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("4761904761904761904761904761904") // 4.76

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(true)
        expect(await globalDelta[1]).eq("3761904761904761904761904761904")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("49853809523") // 502.3 + 1 - 4.76 => 498.53
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("49277619047") // 492.77619047619047619

        await DAI.functions.mint(contrToAccount(vault), expandDecimals(20)).call()
        await vault
            .connect(user2)
            .functions.increase_position(addrToAccount(user2), toAsset(DAI), toAsset(BTC), toUsd(60), false)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(300))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(
            "41311475409836065573770491803278614",
        )

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(true)
        expect(await globalDelta[1]).eq("2261904761904761904761904761904")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50003809523") // 500.038095238095238095
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("49277619047") // 492.77619047619047619

        await DAI.functions.mint(contrToAccount(vault), expandDecimals(20)).call()

        await expect(
            vault
                .connect(user2)
                .functions.increase_position(addrToAccount(user2), toAsset(DAI), toAsset(BTC), toUsd(60), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultMaxShortsExceeded")

        await vault
            .connect(user2)
            .functions.increase_position(addrToAccount(user2), toAsset(DAI), toAsset(BNB), toUsd(60), false)
            .addContracts(attachedContracts)
            .call()
    })
})
