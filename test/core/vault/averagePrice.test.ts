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
    BTC_MAX_LEVERAGE,
    DAI_MAX_LEVERAGE,
    ETH_MAX_LEVERAGE,
    getBtcConfig,
    getDaiConfig,
    getEthConfig,
    validateVaultRouterBalance,
} from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPosition, getPositionLeverage } from "../../utils/contract"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.averagePrice", () => {
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let utils: Utils
    let BNB: Fungible
    let BNBPricefeed: Pricefeed
    let ETH: Fungible
    let ETHPricefeed: Pricefeed
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

        ETH = await deploy("Fungible", deployer)
        ETHPricefeed = await deploy("Pricefeed", deployer)

        DAI = await deploy("Fungible", deployer)
        DAIPricefeed = await deploy("Pricefeed", deployer)

        BTC = await deploy("Fungible", deployer)
        BTCPricefeed = await deploy("Pricefeed", deployer)

        await call(BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed"))
        await call(ETHPricefeed.functions.initialize(addrToAccount(deployer), "ETH Pricefeed"))
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
        await call(vaultPricefeed.functions.set_asset_config(toAsset(ETH), toContract(ETHPricefeed), DECIMALS, false))
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

    it("position.averagePrice, buyPrice < averagePrice", async () => {
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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(36900)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(36900)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(36900)))

        let leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)
        expect(leverage).eq("90817") // ~9X leverage
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(9))

        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultUtilsLiquidationFeesExceedCollateral")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .callParams({
                    // 0.00025 BTC => 10 USD
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(100)) // size
        expect(position.collateral).eq(toUsd(9.91 + 9.215)) // collateral, 0.00025 * 36900 => 9.225, 0.01 fees
        expect(position.average_price).eq("40549450549450549450549450549450549") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(asStr(225000 + 27100)) // reserveAmount, 0.000271 * 36900 => ~10

        leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)
        expect(leverage).eq("52287") // ~5.2X leverage

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 27)) // 0.00000027 * 36900 => 0.01 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr(225000 + 27100))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.875))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 + 25000 - 219 - 27))
        expect(await getBalance(user2, BTC)).eq("0")

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("8999999999999999999999999999999")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("1111111111111111111111111111111") // ~1.111

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })

    it("long position.averagePrice, buyPrice == averagePrice", async () => {
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
                    forward: [250000, getAssetId(BTC)],
                }),
        )

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))
        await call(BTC.functions.mint(addrToAccount(user0), 25000))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("0")

        await call(BTC.functions.mint(addrToAccount(user0), 25000))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(100)) // size
        expect(position.collateral).eq(toUsd(9.91 + 9.99)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(asStr(225000 + 25000)) // reserveAmount

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("0")

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })

    it("long position.averagePrice, buyPrice > averagePrice", async () => {
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
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(22.5))

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(100)) // size
        expect(position.average_price).eq("40816326530612244897959183673469387") // averagePrice

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(22.5))

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })

    it("long position.averagePrice, buyPrice < averagePrice", async () => {
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
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    // 0.000125 BTC => 50 USD
                    forward: [125000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(22.5))

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(100)) // size
        expect(position.average_price).eq("38709677419354838709677419354838709") // averagePrice

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("22499999999999999999999999999999")
    })

    it("long position.averagePrice, buyPrice < averagePrice + minProfitBasisPoints", async () => {
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
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    // 0.000125 BTC => 50 USD
                    forward: [125000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40300)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40300)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40300)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("0")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(100)) // size
        expect(position.average_price).eq(toUsd(40300)) // averagePrice

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("1736972704714640198511166253101") // (700 / 40300) * 100 => 1.73697
    })

    it("short position.averagePrice, buyPrice == averagePrice", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(DAI.functions.mint(addrToAccount(user1), expandDecimals(101)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(101), getAssetId(DAI)],
                }),
        )

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(50)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(50), getAssetId(DAI)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(90))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("0")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(100)) // size
        expect(position.collateral).eq("49900000000000000000000000000000") // collateral
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(100)) // reserveAmount

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("0")
    })

    it("short position.averagePrice, buyPrice > averagePrice", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(DAI.functions.mint(addrToAccount(user1), expandDecimals(101)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(101), getAssetId(DAI)],
                }),
        )

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(50)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(50), getAssetId(DAI)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(90))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("22500000000000000000000000000000") // 22.5

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(100)) // size
        expect(position.collateral).eq("49900000000000000000000000000000") // collateral
        expect(position.average_price).eq("40816326530612244897959183673469387") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(100)) // reserveAmount

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("22500000000000000000000000000000") // 22.5
    })

    it("short position.averagePrice, buyPrice < averagePrice", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(DAI.functions.mint(addrToAccount(user1), expandDecimals(101)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(101), getAssetId(DAI)],
                }),
        )

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(50)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(50), getAssetId(DAI)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(90))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("22500000000000000000000000000000") // 22.5

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(100)) // size
        expect(position.collateral).eq("49900000000000000000000000000000") // collateral
        expect(position.average_price).eq("38709677419354838709677419354838709") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(100)) // reserveAmount

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("22499999999999999999999999999999") // ~22.5
    })

    it("short position.averagePrice, buyPrice < averagePrice - minProfitBasisPoints", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(DAI.functions.mint(addrToAccount(user1), expandDecimals(101)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(101), getAssetId(DAI)],
                }),
        )

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(50)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(50), getAssetId(DAI)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(90))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39700)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39700)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39700)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("0") // 22.5

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, vaultStorage))
        expect(position.size).eq(toUsd(100)) // size
        expect(position.collateral).eq("49900000000000000000000000000000") // collateral
        expect(position.average_price).eq(toUsd(39700)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(expandDecimals(100)) // reserveAmount

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("0") // ~22.5

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("1763224181360201511335012594458") // (39700 - 39000) / 39700 * 100 => 1.7632
    })

    it("long position.averagePrice, buyPrice < averagePrice 2", async () => {
        await call(ETHPricefeed.functions.set_latest_answer("251382560787"))
        await call(vaultStorage.functions.set_asset_config(...getEthConfig(ETH)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(ETH), ETH_MAX_LEVERAGE))

        await call(ETHPricefeed.functions.set_latest_answer("252145037536"))
        await call(ETHPricefeed.functions.set_latest_answer("252145037536"))

        await call(ETH.functions.mint(addrToAccount(user1), expandDecimals(10)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(ETH), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(10), getAssetId(ETH)],
                }),
        )

        await call(ETH.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(
                    addrToAccount(user0),
                    toAsset(ETH),
                    toAsset(ETH),
                    "5050322181222357947081599665915068",
                    true,
                )
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(1), getAssetId(ETH)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(ETH), toAsset(ETH), true, vaultStorage))
        expect(position.size).eq("5050322181222357947081599665915068") // size
        expect(position.collateral).eq("2508775285688777642052918400334084") // averagePrice
        expect(position.average_price).eq("2521450375360000000000000000000000") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate

        await call(ETHPricefeed.functions.set_latest_answer("237323502539"))
        await call(ETHPricefeed.functions.set_latest_answer("237323502539"))
        await call(ETHPricefeed.functions.set_latest_answer("237323502539"))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(ETH), toAsset(ETH), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("296866944860754376482796517102673")

        await call(ETH.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(
                    addrToAccount(user0),
                    toAsset(ETH),
                    toAsset(ETH),
                    "4746470050780000000000000000000000",
                    true,
                )
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(1), getAssetId(ETH)],
                }),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(ETH), toAsset(ETH), true, vaultStorage))
        expect(position.size).eq("9796792232002357947081599665915068") // size
        expect(position.average_price).eq("2447397190894361457116367555285124") // averagePrice
    })
})
