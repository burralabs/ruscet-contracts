import { expect, use } from "chai"
import { AbstractContract, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    Fungible,
    Pricefeed,
    Router,
    TimeDistributor,
    Rusd,
    Utils,
    Vault,
    VaultPricefeed,
    VaultStorage,
    VaultUtils,
    YieldTracker,
} from "../../../types"
import { deploy, getValStr, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toContract } from "../../utils/account"
import { expandDecimals, toPrice, toUsd } from "../../utils/units"
import { toAsset } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { getDaiConfig } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"

use(useChai)

describe("Vault.getPrice", function () {
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
    let USDC: Fungible
    let USDCPricefeed: Pricefeed
    let vault: Vault
    let vaultStorage: VaultStorage
    let vaultUtils: VaultUtils
    let rusd: Rusd
    let router: Router
    let vaultPricefeed: VaultPricefeed
    let timeDistributor: TimeDistributor
    let yieldTracker: YieldTracker

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

        USDC = await deploy("Fungible", deployer)
        USDCPricefeed = await deploy("Pricefeed", deployer)

        await call(BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed"))
        await call(DAIPricefeed.functions.initialize(addrToAccount(deployer), "DAI Pricefeed"))
        await call(BTCPricefeed.functions.initialize(addrToAccount(deployer), "BTC Pricefeed"))
        await call(USDCPricefeed.functions.initialize(addrToAccount(deployer), "USDC Pricefeed"))

        /*
            Vault + Router + RUSD
        */
        utils = await deploy("Utils", deployer)
        vaultStorage = await deploy("VaultStorage", deployer)
        vaultUtils = await deploy("VaultUtils", deployer)
        vault = await deploy("Vault", deployer, { VAULT_STORAGE: toContract(vaultStorage), VAULT_UTILS: toContract(vaultUtils) })
        vaultPricefeed = await deploy("VaultPricefeed", deployer)
        rusd = await deploy("Rusd", deployer)
        router = await deploy("Router", deployer)
        timeDistributor = await deploy("TimeDistributor", deployer)
        yieldTracker = await deploy("YieldTracker", deployer)

        await call(rusd.functions.initialize(toContract(vault)))
        await call(router.functions.initialize(toContract(vault), toContract(rusd), addrToAccount(deployer)))
        await call(
            vaultStorage.functions.initialize(
                addrToAccount(deployer),
                toContract(router),
                toAsset(rusd), // RUSD native asset
                toContract(rusd), // RUSD contract
                toContract(vaultPricefeed),
                toUsd(5), // liquidationFeeUsd
                600, // fundingRateFactor
                600, // stableFundingRateFactor
            ),
        )
        await call(vaultUtils.functions.initialize(addrToAccount(deployer), toContract(vault), toContract(vaultStorage)))
        await call(vault.functions.initialize(addrToAccount(deployer)))
        await call(vaultStorage.functions.write_authorize(contrToAccount(vault), true))
        await call(vaultStorage.functions.write_authorize(contrToAccount(vaultUtils), true))
        await call(vaultUtils.functions.write_authorize(contrToAccount(vault), true))

        await call(yieldTracker.functions.initialize(toContract(rusd)))
        await call(yieldTracker.functions.set_time_distributor(toContract(timeDistributor)))
        await call(timeDistributor.functions.initialize())
        await call(timeDistributor.functions.set_distribution([contrToAccount(yieldTracker)], [1000], [toAsset(BNB)]))

        await call(BNB.functions.mint(contrToAccount(timeDistributor), 5000))
        await call(rusd.functions.set_yield_trackers([{ bits: contrToAccount(yieldTracker).value }]))

        await call(vaultPricefeed.functions.initialize(addrToAccount(deployer)))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(BNB), toContract(BNBPricefeed), 8, false))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(DAI), toContract(DAIPricefeed), 8, false))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(BTC), toContract(BTCPricefeed), 8, false))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(USDC), toContract(USDCPricefeed), 8, true))
    })

    it("get_price", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(DAI), true))).eq(expandDecimals(1, 30))

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1.1)))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(DAI), true))).eq(expandDecimals(11, 29))

        await call(USDCPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(
            vaultStorage.functions.set_asset_config(
                toAsset(USDC), // _token
                8, // _tokenDecimals
                10000, // _tokenWeight
                75, // _minProfitBps,
                0, // _maxRusdAmount
                false, // _isStable
                true, // _isShortable
            ),
        )

        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true))).eq(expandDecimals(1, 30))
        await call(USDCPricefeed.functions.set_latest_answer(toPrice(1.1)))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true))).eq(expandDecimals(11, 29))

        await call(vaultPricefeed.functions.set_max_strict_price_deviation(expandDecimals(1, 29)))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true))).eq(expandDecimals(1, 30))

        await call(USDCPricefeed.functions.set_latest_answer(toPrice(1.11)))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true))).eq(expandDecimals(111, 28))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false))).eq(expandDecimals(1, 30))

        await call(USDCPricefeed.functions.set_latest_answer(toPrice(0.9)))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true))).eq(expandDecimals(111, 28))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false))).eq(expandDecimals(1, 30))

        await call(vaultPricefeed.functions.set_spread_basis_points(toAsset(USDC), 20))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false))).eq(expandDecimals(1, 30))

        await call(vaultPricefeed.functions.set_spread_basis_points(toAsset(USDC), 0))
        await call(USDCPricefeed.functions.set_latest_answer(toPrice(0.89)))
        await call(USDCPricefeed.functions.set_latest_answer(toPrice(0.89)))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true))).eq(expandDecimals(1, 30))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false))).eq(expandDecimals(89, 28))

        await call(vaultPricefeed.functions.set_spread_basis_points(toAsset(USDC), 20))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false))).eq(expandDecimals(89, 28))

        await call(vaultPricefeed.functions.set_use_v2_pricing(true))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false))).eq(expandDecimals(89, 28))

        await call(vaultPricefeed.functions.set_spread_basis_points(toAsset(BTC), 0))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BTC), true))).eq(expandDecimals(40000, 30))

        await call(vaultPricefeed.functions.set_spread_basis_points(toAsset(BTC), 20))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BTC), false))).eq(expandDecimals(39920, 30))
    })
})
