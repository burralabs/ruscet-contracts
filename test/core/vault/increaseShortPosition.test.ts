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
    RlpManager,
} from "../../../types"
import { deploy, getValue, getValStr, formatObj, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../../utils/account"
import { expandDecimals, toNormalizedPrice, toPrice, toUsd } from "../../utils/units"
import { getAssetId, toAsset } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BigNumber } from "ethers"
import { BNB_MAX_LEVERAGE, BTC_MAX_LEVERAGE, DAI_MAX_LEVERAGE, getBnbConfig, getBtcConfig, getDaiConfig } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPosition } from "../../utils/contract"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.increaseShortPosition", function () {
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

    it("increasePosition short validations", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))
        await expect(
            vaultRouter
                .connect(user1)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), 0, false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterInvalidMsgCaller")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterCollateralAssetNotWhitelisted")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterShortCollateralAssetMustBeStableAsset")

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(DAI), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterShortIndexAssetMustNotBeStableAsset")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterShortIndexAssetNotShortable")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(
            vaultStorage.functions.set_asset_config(
                toAsset(BTC), // _token
                8, // _tokenDecimals
                10000, // _tokenWeight
                75, // _minProfitBps
                0, // _maxRusdAmount
                false, // _isStable
                false, // _isShortable
            ),
        )

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterShortIndexAssetNotShortable")

        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterInsufficientCollateralForFees")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), 0, false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterInvalidPositionSize")

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(9, 7), getAssetId(DAI)],
                })
                .call(),
        ).to.be.revertedWith("VaultRouterInsufficientCollateralForFees")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [BigNumber.from(expandDecimals(9, 7)).add(expandDecimals(4)).toString(), getAssetId(DAI)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsLossesExceedCollateral")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [BigNumber.from(expandDecimals(9, 7)).add(expandDecimals(4)).toString(), getAssetId(DAI)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsLiquidationFeesExceedCollateral")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(8), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [
                        BigNumber.from(expandDecimals(9, 7)).add(expandDecimals(4)).add(expandDecimals(6)).toString(),
                        getAssetId(DAI),
                    ],
                })
                .call(),
        ).to.be.revertedWith("VaultRouterSizeMustBeMoreThanCollateral")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(600), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [
                        BigNumber.from(expandDecimals(9, 7)).add(expandDecimals(4)).add(expandDecimals(6)).toString(),
                        getAssetId(DAI),
                    ],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsMaxLeverageExceeded")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [
                        BigNumber.from(expandDecimals(9, 7)).add(expandDecimals(4)).add(expandDecimals(6)).toString(),
                        getAssetId(DAI),
                    ],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")
    })

    it("increasePosition short", async () => {
        await call(vaultStorage.functions.set_max_global_short_size(toAsset(BTC), toUsd(300)))

        let globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq("0")

        await call(
            vaultStorage.functions.set_fees(
                50, // _taxBasisPoints
                10, // _stableTaxBasisPoints
                4, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                0, // _minProfitTime
                false, // _hasDynamicFees
            ),
        )

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(1000)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)))
        await call(DAI.functions.mint(addrToAccount(user1), expandDecimals(1000)))
        await call(DAI.functions.mint(addrToAccount(user2), expandDecimals(1000)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(99), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(500), getAssetId(DAI)],
                })
                .call(),
        ).to.be.revertedWith("VaultRouterSizeMustBeMoreThanCollateral")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(501), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(500), getAssetId(DAI)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("0")

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(DAI)))).eq("0")
        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(500), getAssetId(DAI)],
                }),
        )
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(DAI)))).eq(
            "499800000000000000000000000000000",
        )

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq("0")

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(501), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(20), getAssetId(DAI)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq("0") // size
        expect(position.collateral).eq("0") // collateral
        expect(position.average_price).eq("0") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("0") // reserveAmount
        expect(position.realized_pnl.value).eq("0") // realisedPnl
        expect(position.realized_pnl.is_neg).eq(false) // hasProfit
        expect(position.last_increased_time).eq("0") // lastIncreasedTime

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .callParams({
                    forward: [expandDecimals(20), getAssetId(DAI)],
                })
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("49980000000")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(90))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(DAI)))).eq(
            "499800000000000000000000000000000",
        )

        let timestamp = await getValStr(utils.functions.get_unix_timestamp())

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(19.91)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(90)) // reserveAmount
        expect(position.realized_pnl.value).eq("0") // realisedPnl
        expect(position.realized_pnl.is_neg).eq(false) // hasProfit
        let lastIncreasedTime = BigNumber.from(position.last_increased_time)
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

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(2.25))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(42000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(42000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(42000)))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(4.5))

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(4.5))

        await call(
            vaultRouter
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
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(40)) // size
        expect(position.collateral).eq(toUsd(14.41)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(40)) // reserveAmount
        expect(position.realized_pnl.value).eq(toUsd(2.5)) // realisedPnl
        expect(position.realized_pnl.is_neg).eq(true) // hasProfit
        // timestamp is within a deviation of 2 (actually: 1), so account for that here
        expect(lastIncreasedTime.gte(BigNumber.from(timestamp).sub(2)) && lastIncreasedTime.lte(BigNumber.from(timestamp).add(2)))
            .to.be.true // lastIncreasedTime

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

        await call(DAI.functions.mint(contrToAccount(vaultRouter), expandDecimals(50)))
        await call(
            vaultRouter
                .connect(user1)
                .functions.increase_position(addrToAccount(user1), toAsset(DAI), toAsset(BTC), toUsd(200), false)
                .callParams({
                    forward: [expandDecimals(20), getAssetId(DAI)],
                })
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(240))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(
            "41652892561983471074380165289256198",
        )

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(2))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))

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

        await call(DAI.functions.mint(contrToAccount(vaultRouter), expandDecimals(20)))
        await call(
            vaultRouter
                .connect(user2)
                .functions.increase_position(addrToAccount(user2), toAsset(DAI), toAsset(BTC), toUsd(60), false)
                .callParams({
                    forward: [expandDecimals(20), getAssetId(DAI)],
                })
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(300))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(
            "41311475409836065573770491803278614",
        )

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(true)
        expect(await globalDelta[1]).eq("2261904761904761904761904761904")

        await call(DAI.functions.mint(contrToAccount(vaultRouter), expandDecimals(20)))

        await expect(
            vaultRouter
                .connect(user2)
                .functions.increase_position(addrToAccount(user2), toAsset(DAI), toAsset(BTC), toUsd(60), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(20), getAssetId(DAI)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsMaxShortsExceeded")

        await call(
            vaultRouter
                .connect(user2)
                .functions.increase_position(addrToAccount(user2), toAsset(DAI), toAsset(BNB), toUsd(60), false)
                .callParams({
                    forward: [expandDecimals(20), getAssetId(DAI)],
                })
                .addContracts(attachedContracts),
        )
    })
})
