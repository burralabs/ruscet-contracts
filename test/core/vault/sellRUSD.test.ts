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
import { deploy, getBalance, getValStr, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toPrice, toUsd } from "../../utils/units"
import { getAssetId, toAsset } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BNB_MAX_LEVERAGE, BTC_MAX_LEVERAGE, DAI_MAX_LEVERAGE, getBnbConfig, getBtcConfig, getDaiConfig } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.sellRUSD", function () {
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
    let RUSD: string // the RUSD fungible asset
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

        RUSD = getAssetId(rusd)

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

    it("sellRUSD", async () => {
        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.sell_rusd(toAsset(BNB), addrToAccount(user1))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterAssetNotWhitelisted")

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BNB.functions.mint(addrToAccount(user0), 100))

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        expect(await getBalance(user0, BNB)).eq("100")

        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(user0))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [100, getAssetId(BNB)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq("29700")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))
        expect(await getBalance(user0, BNB)).eq("0")

        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.sell_rusd(toAsset(BNB), addrToAccount(user1))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterInvalidRusdAmount")

        await expect(
            call(
                vaultRouter
                    .as(user0)
                    .functions.sell_rusd(toAsset(BTC), addrToAccount(user1))
                    .addContracts(attachedContracts)
                    .callParams({
                        forward: [15000, getAssetId(rusd)],
                    }),
            ),
        ).to.be.revertedWith("VaultRouterInvalidRedemptionAmount")

        console.log("user0 RUSD balance", await getBalance(user0, RUSD))
        await call(
            vaultRouter
                .connect(user0)
                .functions.sell_rusd(toAsset(BNB), addrToAccount(user1))
                .callParams({
                    forward: [15000, getAssetId(rusd)],
                })
                .addContracts(attachedContracts),
        )
        expect(await getBalance(user0, RUSD)).eq(asStr(29700 - 15000))
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("2")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq(asStr(29700 - 15000))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1 - 50))
        expect(await getBalance(user0, BNB)).eq("0")
        expect(await getBalance(user1, BNB)).eq(asStr(50 - 1)) // (15000 / 300) => 50
    })

    it("sellRUSD after a price increase", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        await call(BNB.functions.mint(addrToAccount(user0), 100))

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        expect(await getBalance(user0, BNB)).eq("100")
        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(user0))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [100, getAssetId(BNB)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq("29700")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))
        expect(await getBalance(user0, BNB)).eq("0")

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(400)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(600)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))

        await call(
            vaultRouter
                .as(user0)
                .functions.sell_rusd(toAsset(BNB), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [15000, getAssetId(rusd)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq(asStr(29700 - 15000))
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("2")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq(asStr(29700 - 15000))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1 - 25))
        expect(await getBalance(user0, BNB)).eq("0")
        expect(await getBalance(user1, BNB)).eq(asStr(25 - 1)) // (15000 / 600) => 25
    })

    it("sellRUSD redeem based on price", async () => {
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(2)))

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("0")
        expect(await getBalance(user0, BTC)).eq(expandDecimals(2))

        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user0))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(2), getAssetId(BTC)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq("11964000000000") // 119,640
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("600000") // 0.006 BTC, 2 * 0.03%
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("11964000000000") // 119,640
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("199400000") // 1.994 BTC
        expect(await getBalance(user0, BTC)).eq("0")
        expect(await getBalance(user1, BTC)).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(82000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(80000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(83000)))

        await call(
            vaultRouter
                .connect(user0)
                .functions.sell_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(10000), getAssetId(rusd)],
                }),
        )

        expect(await getBalance(user1, BTC)).eq("12012047") // 0.12012047 BTC, 0.12012047 * 83000 => 9969.999
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("636145") // 0.00636145
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("187351808") // 199400000-(636145-600000)-12012047 => 187351808
    })

    it("sellRUSD for stableTokens", async () => {
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

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(10000)))

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("0")
        expect(await getBalance(user0, DAI)).eq(expandDecimals(10000))

        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(user0))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(10000), getAssetId(DAI)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq(expandDecimals(9996))
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq(expandDecimals(4))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq(expandDecimals(9996))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq(expandDecimals(9996))
        expect(await getBalance(user0, DAI)).eq("0")
        expect(await getBalance(user1, DAI)).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(5000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))

        expect(await getBalance(user2, DAI)).eq("0")

        await call(
            vaultRouter
                .connect(user0)
                .functions.swap(toAsset(BTC), toAsset(DAI), addrToAccount(user2))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(1), getAssetId(BTC)],
                }),
        )

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq(expandDecimals(19))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq(expandDecimals(4996))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq(expandDecimals(4996))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq(expandDecimals(5000))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(expandDecimals(1))

        expect(await getBalance(user2, DAI)).eq(expandDecimals(4985))
    })
})
