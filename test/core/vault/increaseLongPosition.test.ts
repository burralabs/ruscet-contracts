import { expect, use } from "chai"
import { AbstractContract, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    Fungible,
    Rlp,
    Pricefeed,
    TimeDistributor,
    Rusd,
    Utils,
    VaultRouter,
    VaultPricefeed,
    VaultStorage,
    VaultUtils,
    Vault,
    YieldTracker,
    VaultRusd,
    VaultPosition,
} from "../../../types"
import { deploy, getValue, getValStr, formatObj, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd } from "../../utils/units"
import { getAssetId, toAsset } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BigNumber } from "ethers"
import { BTC_MAX_LEVERAGE, DAI_MAX_LEVERAGE, getBtcConfig, getDaiConfig, validateVaultRouterBalance } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPosition } from "../../utils/contract"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.increaseLongPosition", function () {
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let utils: Utils
    let BNB: Fungible
    let BNBPricefeed: Pricefeed
    let DAI: Fungible
    let DAIPricefeed: Pricefeed
    let BTC: Fungible
    let BTCPricefeed: Pricefeed
    let vaultRouter: VaultRouter
    let vaultStorage: VaultStorage
    let vaultUtils: VaultUtils
    let vault: Vault
    let vaultRusd: VaultRusd
    let vaultPosition: VaultPosition
    let rusd: Rusd
    let vaultPricefeed: VaultPricefeed
    let timeDistributor: TimeDistributor
    let yieldTracker: YieldTracker
    let rlp: Rlp

    beforeEach(async () => {
        const FUEL_NETWORK_URL = "http://127.0.0.1:4000/v1/graphql"
        const localProvider = await Provider.create(FUEL_NETWORK_URL)

        const wallets = WALLETS.map((k) => Wallet.fromPrivateKey(k, localProvider))
        ;[deployer, user0, user1, user2, user3] = wallets

        /*
            NativeAsset + Pricefeed
        */
        BNB = await deploy("Fungible", deployer)
        BNBPricefeed = await deploy("Pricefeed", deployer)

        DAI = await deploy("Fungible", deployer)
        DAIPricefeed = await deploy("Pricefeed", deployer)

        BTC = await deploy("Fungible", deployer)
        BTCPricefeed = await deploy("Pricefeed", deployer)

        await call(BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed"))
        await call(DAIPricefeed.functions.initialize(addrToAccount(deployer), "DAI Pricefeed"))
        await call(BTCPricefeed.functions.initialize(addrToAccount(deployer), "BTC Pricefeed"))

        /*
            VaultRouter + Router + RUSD
        */
        utils = await deploy("Utils", deployer)
        vaultStorage = await deploy("VaultStorage", deployer)
        vaultUtils = await deploy("VaultUtils", deployer)
        vault = await deploy("Vault", deployer)
        vaultRouter = await deploy("VaultRouter", deployer)
        vaultRusd = await deploy("VaultRusd", deployer)
        vaultPosition = await deploy("VaultPosition", deployer)
        vaultPricefeed = await deploy("VaultPricefeed", deployer)
        rusd = await deploy("Rusd", deployer)
        timeDistributor = await deploy("TimeDistributor", deployer)
        yieldTracker = await deploy("YieldTracker", deployer)
        rlp = await deploy("Rlp", deployer)
        attachedContracts = [vaultUtils, vaultStorage, vault, vaultRusd, vaultPosition, vaultPricefeed, rusd]

        await call(rusd.functions.initialize(toContract(vaultRusd), toAddress(user0)))

        await call(
            vaultStorage.functions.initialize(
                addrToAccount(deployer),
                toContract(rusd),
                toAsset(rusd), // RUSD native asset
                toContract(vaultPricefeed),
            ),
        )
        await call(
            vaultUtils.functions.initialize(
                addrToAccount(deployer),
                toContract(vaultRouter),
                toContract(vaultStorage),
                toContract(vault),
            ),
        )
        await call(
            vaultRouter.functions.initialize(
                addrToAccount(deployer),
                toContract(vaultStorage),
                toContract(vaultUtils),
                toContract(vault),
                toContract(vaultRusd),
                toContract(vaultPosition),
            ),
        )
        await call(vaultStorage.functions.write_authorize(contrToAccount(vaultRouter), true))
        await call(vaultStorage.functions.write_authorize(contrToAccount(vaultUtils), true))
        await call(vaultStorage.functions.write_authorize(contrToAccount(vaultRusd), true))
        await call(vaultStorage.functions.write_authorize(contrToAccount(vaultPosition), true))

        await call(vaultUtils.functions.write_authorize(contrToAccount(vaultRouter), true))
        await call(vaultUtils.functions.write_authorize(contrToAccount(vaultRusd), true))
        await call(vaultUtils.functions.write_authorize(contrToAccount(vaultPosition), true))

        await call(vault.functions.initialize(addrToAccount(deployer)))
        await call(vault.functions.set_vault(toContract(vaultRusd), true))
        await call(vault.functions.set_vault(toContract(vaultPosition), true))

        await call(
            vaultRusd.functions.initialize(
                addrToAccount(deployer),
                toContract(vaultRouter),
                toContract(vaultStorage),
                toContract(vaultUtils),
                toContract(vault),
            ),
        )
        await call(
            vaultPosition.functions.initialize(
                addrToAccount(deployer),
                toContract(vaultRouter),
                toContract(vaultStorage),
                toContract(vaultUtils),
                toContract(vault),
            ),
        )

        await call(yieldTracker.functions.initialize(toContract(rusd)))
        await call(yieldTracker.functions.set_time_distributor(toContract(timeDistributor)))
        await call(timeDistributor.functions.initialize())
        await call(timeDistributor.functions.set_distribution([contrToAccount(yieldTracker)], [1000], [toAsset(BNB)]))

        await call(BNB.functions.mint(contrToAccount(timeDistributor), 5000))
        await call(rusd.functions.set_yield_trackers([{ bits: contrToAccount(yieldTracker).value }]))

        await call(vaultPricefeed.functions.initialize(addrToAccount(deployer)))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(BNB), toContract(BNBPricefeed), DECIMALS, false))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(DAI), toContract(DAIPricefeed), DECIMALS, false))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(BTC), toContract(BTCPricefeed), DECIMALS, false))

        await call(
            vaultUtils.functions.set_funding_rate(
                8 * 3600, // funding_interval (8 hours)
                600, // fundingRateFactor
                600, // stableFundingRateFactor
            ),
        )

        await call(rlp.functions.initialize())
    })

    it("increasePosition long validations", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await expect(
            vaultRouter
                .connect(user1)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterInvalidMsgCaller")

        await call(vaultStorage.connect(user0).functions.set_approved_router(addrToAccount(user1.address), true))

        await expect(
            vaultRouter
                .connect(user1)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BNB), 0, true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterCollateralAssetNotWhitelisted")

        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BNB), toUsd(1000), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterLongCollateralIndexAssetsMismatch")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(DAI), toUsd(1000), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterLongCollateralAssetMustNotBeStableAsset")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(1000), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterInsufficientCollateralForFees")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterInvalidPositionSize")

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(1000), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [2500 - 1, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultRouterInsufficientCollateralForFees")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(1000), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [2500, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsLossesExceedCollateral")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(1000), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [2500, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsFeesExceedCollateral")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(1000), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [2500 + 10000, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsLiquidationFeesExceedCollateral")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(500), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [2500 + 10000 + 10000, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsMaxLeverageExceeded")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(8), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [2500 + 10000 + 10000, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultRouterSizeMustBeMoreThanCollateral")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(47), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [2500 + 10000 + 10000, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")
    })

    it("increasePosition long", async () => {
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(118), true)
                .addContracts(attachedContracts)
                .callParams({
                    // 0.001174 BTC => 47
                    forward: [117500 - 1, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("0")

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq("0")
        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    // 0.001174 BTC => 47
                    forward: [117500 - 1, getAssetId(BTC)],
                }),
        )
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd("46.8584"))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("353") // (117500 - 1) * 0.3% => 353
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("4685840000") // (117500 - 1 - 353) * 40000
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(117500 - 1 - 353))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(200), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [117500 - 1, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [117500 - 1, getAssetId(BTC)],
                }),
        )

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd("93.7168"))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2)) // (117500 - 1) * 0.3% * 2
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr((117500 - 1 - 353) * 2))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(47), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterInsufficientCollateralForFees")

        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq("0") // size
        expect(position.collateral).eq("0") // collateral
        expect(position.average_price).eq("0") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("0") // reserveAmount
        expect(position.realized_pnl.value).eq("0") // realisedPnl
        expect(position.realized_pnl.is_neg).eq(false) // hasProfit
        expect(position.last_increased_time).eq("0") // lastIncreasedTime

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(47), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [22500, getAssetId(BTC)],
                }),
        )

        let timestamp = await getValStr(utils.functions.get_unix_timestamp())

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(256792 - 114))
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("117500")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(38.047))
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd(92.79))

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(47)) // size
        expect(position.collateral).eq(toUsd(8.953)) // collateral, 0.000225 BTC => 9, DECIMALS - 0.047 => 8.953
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("117500") // reserveAmount
        expect(position.realized_pnl.value).eq("0") // realisedPnl
        expect(position.realized_pnl.is_neg).eq(false) // hasProfit
        let lastIncreasedTime = BigNumber.from(position.last_increased_time)
        // timestamp is within a deviation of 2 (actually: 1), so account for that here
        expect(lastIncreasedTime.gte(BigNumber.from(timestamp).sub(2)) && lastIncreasedTime.lte(BigNumber.from(timestamp).add(2)))
            .to.be.true // lastIncreasedTime

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2 + 114)) // fee is 0.047 USD => 0.00000114 BTC
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr((117500 - 1 - 353) * 2 + 22500 - 114),
        )

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq("0")

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })

    it("increasePosition long aum", async () => {
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(100000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(100000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(100000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("0")

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq("0")
        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(1), getAssetId(BTC)],
                }),
        )
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd(99700))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("300000") // 0.003 BTC
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq(expandDecimals(99700, DECIMALS))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("99700000") // 0.997

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(5, 7)))

        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq("0") // size
        expect(position.collateral).eq("0") // collateral
        expect(position.average_price).eq("0") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("0") // reserveAmount
        expect(position.realized_pnl.value).eq("0") // realisedPnl
        expect(position.realized_pnl.is_neg).eq(false) // hasProfit
        expect(position.last_increased_time).eq("0") // lastIncreasedTime

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(80000), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(5, 7), getAssetId(BTC)],
                }),
        )

        let timestamp = await getValStr(utils.functions.get_unix_timestamp())

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("149620000") // 1.4962 BTC
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("80000000") // 0.8 BTC
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(30080)) // 80000 - 49920
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd(99700))

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(80000)) // size
        expect(position.collateral).eq(toUsd(49920)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(100000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("80000000") // 0.8 BTC
        expect(position.realized_pnl.value).eq("0") // realisedPnl
        expect(position.realized_pnl.is_neg).eq(false) // hasProfit
        // timestamp is within a deviation of 2 (actually: 1), so account for that here
        let lastIncreasedTime = BigNumber.from(position.last_increased_time)
        expect(lastIncreasedTime.gte(BigNumber.from(timestamp).sub(2)) && lastIncreasedTime.lte(BigNumber.from(timestamp).add(2)))
            .to.be.true // lastIncreasedTime

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(150000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(150000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(150000)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(40000))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(75000)))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(40000))

        await call(
            vaultRouter
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    0,
                    toUsd(80000),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq("0") // size
        expect(position.collateral).eq("0") // collateral
        expect(position.average_price).eq("0") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("0") // reserveAmount
        expect(position.realized_pnl.value).eq("0") // realisedPnl
        expect(position.realized_pnl.is_neg).eq(false) // hasProfit
        expect(position.last_increased_time).eq("0") // lastIncreasedTime

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("136393334") // 1.36393334 BTC
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0") // 0.8 BTC
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(0))
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(
            "68196667000000000000000000000000000",
        )

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq("0")

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })
})
