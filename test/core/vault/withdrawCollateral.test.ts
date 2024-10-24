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
import { BNB_MAX_LEVERAGE, BTC_MAX_LEVERAGE, DAI_MAX_LEVERAGE, getBnbConfig, getBtcConfig, getDaiConfig } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPosition, getPositionLeverage } from "../../utils/contract"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.withdrawCollateral", function () {
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
        attachedContracts = [vaultUtils, vaultStorage, vault, vaultRusd, vaultPosition, vaultPricefeed, rusd, rlp]

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

    it("withdraw collateral", async () => {
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
                .callParams({
                    // 0.00025 BTC => 10 USD
                    forward: [25000, getAssetId(BTC)],
                })
                .addContracts(attachedContracts),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(46100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(47100)))

        let leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)
        expect(leverage).eq("90817") // ~9X leverage

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
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 16878 - 106 - 1 - 219))
        expect(await getBalance(user2, BTC)).eq("16878") // 0.00016878 * 47100 => 7.949538 USD

        await expect(
            call(
                vaultRouter
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
                    toUsd(1),
                    0,
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(40)) // size
        expect(position.collateral).eq(toUsd(9.91 - 3 - 1)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq(asStr((225000 / 90) * 40)) // reserveAmount, 0.00225 * 40,000 => 90
        expect(position.realized_pnl.value).eq(toUsd(5)) // pnl
        expect(position.realized_pnl.is_neg).eq(false)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 106)) // 0.00000106 * 45100 => ~0.05 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr((225000 / 90) * 40))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(34.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr(274250 - 16878 - 106 - 1 - 2123 - 219),
        ) // 0.00002123 * 47100 => 1 USD
        expect(await getBalance(user2, BTC)).eq(asStr(16878 + 2123))
    })

    it("withdraw during cooldown duration", async () => {
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
                    .callParams({
                        // 0.00025 BTC => 10 USD
                        forward: [25000, getAssetId(BTC)],
                    })
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .callParams({
                    // 0.00025 BTC => 10 USD
                    forward: [25000, getAssetId(BTC)],
                })
                .addContracts(attachedContracts),
        )
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(46100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(47100)))

        // it's okay to withdraw AND decrease size with at least same proportion (e.g. if leverage is decreased or the same)
        await call(
            vaultRouter
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
                .addContracts(attachedContracts),
        )

        // it's also okay to fully close position
        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        await call(
            vaultRouter
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    position.collateral,
                    position.size,
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(30), true)
                .callParams({
                    // 0.00025 BTC => 10 USD
                    forward: [25000, getAssetId(BTC)],
                })
                .addContracts(attachedContracts),
        )
    })

    it("withdraw collateral long", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))

        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(100)))
        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(10), getAssetId(BNB)],
                }),
        )

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(2000), true)
                .callParams({
                    forward: [expandDecimals(1), getAssetId(BNB)],
                })
                .addContracts(attachedContracts),
        )

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(750)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(750)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(750)))

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(0), true)
                .callParams({
                    forward: [expandDecimals(1), getAssetId(BNB)],
                })
                .addContracts(attachedContracts),
        )

        await call(
            vaultRouter
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
                .addContracts(attachedContracts),
        )

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(400)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(400)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(400)))

        await call(
            vaultRouter
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
                .addContracts(attachedContracts),
        )

        await call(
            vaultRouter
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
                .addContracts(attachedContracts),
        )
    })

    it("withdraw collateral short", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(8000 + 500 + 500)))
        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(8000), getAssetId(DAI)],
                }),
        )

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BNB), toUsd(2000), false)
                .callParams({
                    forward: [expandDecimals(500), getAssetId(DAI)],
                })
                .addContracts(attachedContracts),
        )

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(525)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(525)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(525)))

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BNB), toUsd(0), false)
                .callParams({
                    forward: [expandDecimals(500), getAssetId(DAI)],
                })
                .addContracts(attachedContracts),
        )

        await call(
            vaultRouter
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
                .addContracts(attachedContracts),
        )

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(475)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(475)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(475)))

        await call(
            vaultRouter
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
                .addContracts(attachedContracts),
        )
    })
})
