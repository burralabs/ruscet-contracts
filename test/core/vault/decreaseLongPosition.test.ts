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
import { deploy, getBalance, getValue, getValStr, formatObj, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd } from "../../utils/units"
import { getAssetId, toAsset } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import {
    BNB_MAX_LEVERAGE,
    BTC_MAX_LEVERAGE,
    DAI_MAX_LEVERAGE,
    getBnbConfig,
    getBtcConfig,
    getDaiConfig,
    validateVaultRouterBalance,
} from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPosition, getPositionLeverage } from "../../utils/contract"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.decreaseLongPosition", () => {
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
            vaultStorage.functions.set_fees(
                50, // _taxBasisPoints
                20, // _stableTaxBasisPoints
                30, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                60 * 60, // _minProfitTime
                false, // _hasDynamicFees
            ),
        )

        await call(
            vaultUtils.functions.set_funding_rate(
                8 * 3600, // funding_interval (8 hours)
                600, // fundingRateFactor
                600, // stableFundingRateFactor
            ),
        )

        await call(rlp.functions.initialize())
    })

    it("decreasePosition long", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await expect(
            call(
                vaultRouter
                    .connect(user1)
                    .functions.decrease_position(
                        addrToAccount(user0),
                        toAsset(BTC),
                        toAsset(BTC),
                        0,
                        0,
                        true,
                        addrToAccount(user2),
                    )
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterInvalidMsgCaller")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.decrease_position(
                        addrToAccount(user0),
                        toAsset(BTC),
                        toAsset(BTC),
                        0,
                        toUsd(1000),
                        true,
                        addrToAccount(user2),
                    )
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterEmptyPosition")

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    // 0.0025 BTC => 100 USD
                    forward: [250000, getAssetId(BTC)],
                }),
        )

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                    .addContracts(attachedContracts)
                    .callParams({
                        // 0.00025 BTC => 10 USD
                        forward: [25000, getAssetId(BTC)],
                    }),
            ),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    // 0.00025 BTC => 10 USD
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        // test that minProfitBasisPoints works as expected
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)))
        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("2195121951219512195121951219") // ~0.00219512195 USD

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307))) // 41000 * 0.75% => 307.5
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 308)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 308)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 308)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("676097560975609756097560975609") // ~0.676 USD

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45100)))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("2195121951219512195121951219512") // ~2.1951

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(46100)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("2195121951219512195121951219512") // ~2.1951

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(47100)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(9))

        let leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)

        expect(leverage).eq("90817") // ~9X leverage

        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.decrease_position(
                        addrToAccount(user0),
                        toAsset(BTC),
                        toAsset(BTC),
                        0,
                        toUsd(100),
                        true,
                        addrToAccount(user2),
                    )
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultPositionSizeExceeded")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        await call(
            vaultRouter
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
                .addContracts(attachedContracts),
        )

        leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)

        expect(leverage).eq("57887") // ~5.8X leverage

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(40)) // size
        expect(position.collateral).eq(toUsd(9.91 - 3)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(asStr((225000 / 90) * 40)) // reserveAmount, 0.00225 * 40,000 => 90
        expect(position.realized_pnl.value).eq(toUsd(5)) // pnl
        expect(position.realized_pnl.is_neg).eq(false)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 106)) // 0.00000106 * 45100 => ~0.05 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr((225000 / 90) * 40))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(33.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 16878 - 106 - 1))
        expect(await getBalance(user2, BTC)).eq("16878") // 0.00016878 * 47100 => 7.949538 USD

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC, 1)
    })

    it("decreasePosition long aum", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))

        await call(BNB.functions.mint(addrToAccount(deployer), expandDecimals(10)))
        await call(
            vaultRouter.functions
                .buy_rusd(toAsset(BNB), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(10), getAssetId(BNB)],
                }),
        )

        await call(BNB.functions.mint(addrToAccount(deployer), expandDecimals(1)))
        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(1000), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(1), getAssetId(BNB)],
                }),
        )

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(750)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(750)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(750)))

        await call(
            vaultRouter
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BNB),
                    toAsset(BNB),
                    toUsd(0),
                    toUsd(500),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        await call(
            vaultRouter
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BNB),
                    toAsset(BNB),
                    toUsd(250),
                    toUsd(100),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )
    })

    it("decreasePosition long minProfitBasisPoints", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await expect(
            call(
                vaultRouter
                    .connect(user1)
                    .functions.decrease_position(
                        addrToAccount(user0),
                        toAsset(BTC),
                        toAsset(BTC),
                        0,
                        0,
                        true,
                        addrToAccount(user2),
                    )
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterInvalidMsgCaller")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.decrease_position(
                        addrToAccount(user0),
                        toAsset(BTC),
                        toAsset(BTC),
                        0,
                        toUsd(1000),
                        true,
                        addrToAccount(user2),
                    )
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterEmptyPosition")

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    // 0.0025 BTC => 100 USD
                    forward: [250000, getAssetId(BTC)],
                }),
        )

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                    .addContracts(attachedContracts)
                    .callParams({
                        // 0.00025 BTC => 10 USD
                        forward: [25000, getAssetId(BTC)],
                    }),
            ),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    // 0.00025 BTC => 10 USD
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        // test that minProfitBasisPoints works as expected
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)))
        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("2195121951219512195121951219") // ~0.00219512195 USD

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307))) // 41000 * 0.75% => 307.5
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("0")

        // await increaseTime(provider, 50 * 60)
        // await mineBlock(provider)

        // delta = formatObj(await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)))
        // expect(delta[0]).eq(true)
        // expect(delta[1]).eq("0")

        // await increaseTime(provider, 10 * 60 + 10)
        // await mineBlock(provider)

        // delta = formatObj(await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)))
        // expect(delta[0]).eq(true)
        // expect(delta[1]).eq("673902439024390243902439024390") // 0.67390243902
    })

    it("decreasePosition long with loss", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    // 0.0025 BTC => 100 USD
                    forward: [250000, getAssetId(BTC)],
                }),
        )

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                    .addContracts(attachedContracts)
                    .callParams({
                        // 0.00025 BTC => 10 USD
                        forward: [25000, getAssetId(BTC)],
                    }),
            ),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    // 0.00025 BTC => 10 USD
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40790)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40690)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40590)))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(0.9))

        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.decrease_position(
                        addrToAccount(user0),
                        toAsset(BTC),
                        toAsset(BTC),
                        toUsd(4),
                        toUsd(50),
                        true,
                        addrToAccount(user2),
                    )
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultUtilsLiquidationFeesExceedCollateral")

        await call(
            vaultRouter
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    toUsd(0),
                    toUsd(50),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(40)) // size
        expect(position.collateral).eq(toUsd(9.36)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("100000") // reserveAmount, 0.00100 * 40,000 => 40
        expect(position.realized_pnl.value).eq(toUsd(0.5)) // pnl
        expect(position.realized_pnl.is_neg).eq(true)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 122)) // 0.00000122 * 40790 => ~0.05 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("100000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(30.64))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 122))
        expect(await getBalance(user2, BTC)).eq("0")

        await call(
            vaultRouter
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    toUsd(0),
                    toUsd(40),
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
        expect(position.realized_pnl.value).eq("0") // pnl
        expect(position.realized_pnl.is_neg).eq(false)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 122 + 98)) // 0.00000098 * 40790 => ~0.04 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 122 - 98 - 21868))
        expect(await getBalance(user2, BTC)).eq("21868") // 0.00021868 * 40790 => ~8.92 USD

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })

    it("decreasePosition negative collateral", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    // 0.0025 BTC => 100 USD
                    forward: [250000, getAssetId(BTC)],
                }),
        )

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                    .addContracts(attachedContracts)
                    .callParams({
                        // 0.00025 BTC => 10 USD
                        forward: [25000, getAssetId(BTC)],
                    }),
            ),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    // 0.00025 BTC => 10 USD
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(80000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(80000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(80000)))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("975")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("274025")
        expect(await getBalance(user2, BTC)).eq("0")

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(90))

        expect(await getValStr(vaultUtils.functions.get_cumulative_funding_rates(toAsset(BTC)))).eq("0")

        // await increaseTime(provider, 100 * 24 * 60 * 60)

        // await  call(vaultRouter.functions.update_cumulative_funding_rate(toAsset(BTC), toAsset(BTC)))
        // expect(await getValStr(vaultUtils.functions.get_cumulative_funding_rates(toAsset(BTC)))).eq("147796")

        // @TODO: this doesn't revert for some reason
        // await expect(call(
        //     vault
        //         .connect(user0)
        //         .functions.decrease_position(
        //             toAddress(user0),
        //             toAsset(BTC),
        //             toAsset(BTC),
        //             0,
        //             toUsd(10),
        //             true,
        //             addrToAccount(user2),
        //         )
        // .addContracts(attachedContracts)
        // ).to.be.revertedWith("ArithmeticOverflow")

        await call(
            vaultRouter
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    0,
                    toUsd(50),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(40)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        // @TODO: uncomment the following when mineBlock is available for Fuel node
        // expect(position.entry_funding_rate).eq(147796") // entryFundingRate
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("100000") // reserveAmount, 0.00100 * 40,000 => 40
        expect(position.realized_pnl.value).eq(toUsd(50)) // pnl
        expect(position.realized_pnl.is_neg).eq(false)

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC, 1)
    })
})
