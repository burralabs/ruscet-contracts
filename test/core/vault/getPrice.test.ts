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

describe("Vault.get_price", function () {
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
    let USDC: FungibleAbi
    let USDCPricefeed: PricefeedAbi
    let vault: VaultAbi
    let vaultStorage: VaultStorageAbi
    let vaultUtils: VaultUtilsAbi
    let rusd: RusdAbi
    let router: RouterAbi
    let vaultPricefeed: VaultPricefeedAbi
    let timeDistributor: TimeDistributorAbi
    let yieldTracker: YieldTrackerAbi

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

        USDC = (await deploy("Fungible", deployer)) as FungibleAbi
        USDCPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        await BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed").call()
        await DAIPricefeed.functions.initialize(addrToAccount(deployer), "DAI Pricefeed").call()
        await BTCPricefeed.functions.initialize(addrToAccount(deployer), "BTC Pricefeed").call()
        await USDCPricefeed.functions.initialize(addrToAccount(deployer), "USDC Pricefeed").call()

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
        await vaultPricefeed.functions.set_asset_config(toAsset(USDC), toContract(USDCPricefeed), 8, true).call()
    })

    it("get_price", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(DAI), true, true, true))).eq(expandDecimals(1, 30))

        await DAIPricefeed.functions.set_latest_answer(toPrice(1.1)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(DAI), true, true, true))).eq(expandDecimals(11, 29))

        await USDCPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions
            .set_asset_config(
                toAsset(USDC), // _token
                8, // _tokenDecimals
                10000, // _tokenWeight
                75, // _minProfitBps,
                0, // _maxRusdAmount
                false, // _isStable
                true, // _isShortable
            )
            .call()

        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true, true, true))).eq(expandDecimals(1, 30))
        await USDCPricefeed.functions.set_latest_answer(toPrice(1.1)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true, true, true))).eq(expandDecimals(11, 29))

        await vaultPricefeed.functions.set_max_strict_price_deviation(expandDecimals(1, 29)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true, true, true))).eq(expandDecimals(1, 30))

        await USDCPricefeed.functions.set_latest_answer(toPrice(1.11)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true, true, true))).eq(expandDecimals(111, 28))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false, true, true))).eq(expandDecimals(1, 30))

        await USDCPricefeed.functions.set_latest_answer(toPrice(0.9)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true, true, true))).eq(expandDecimals(111, 28))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false, true, true))).eq(expandDecimals(1, 30))

        await vaultPricefeed.functions.set_spread_basis_points(toAsset(USDC), 20).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false, true, true))).eq(expandDecimals(1, 30))

        await vaultPricefeed.functions.set_spread_basis_points(toAsset(USDC), 0).call()
        await USDCPricefeed.functions.set_latest_answer(toPrice(0.89)).call()
        await USDCPricefeed.functions.set_latest_answer(toPrice(0.89)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), true, true, true))).eq(expandDecimals(1, 30))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false, true, true))).eq(expandDecimals(89, 28))

        await vaultPricefeed.functions.set_spread_basis_points(toAsset(USDC), 20).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false, true, true))).eq(expandDecimals(89, 28))

        await vaultPricefeed.functions.set_use_v2_pricing(true).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(USDC), false, true, true))).eq(expandDecimals(89, 28))

        await vaultPricefeed.functions.set_spread_basis_points(toAsset(BTC), 0).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BTC), true, true, true))).eq(expandDecimals(40000, 30))

        await vaultPricefeed.functions.set_spread_basis_points(toAsset(BTC), 20).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BTC), false, true, true))).eq(expandDecimals(39920, 30))
    })

    /*
    it("includes AMM price", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(600)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(80000)).call()
        await busdPriceFeed.setLatestAnswer(toPrice(1))
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()
        const bnbBusd = await deployContract("PancakePair", [])
        await bnbBusd.setReserves(expandDecimals(1000, 18), expandDecimals(300 * 1000, 18))
        const ethBnb = await deployContract("PancakePair", [])
        await ethBnb.setReserves(expandDecimals(800, 18), expandDecimals(100, 18))
        const btcBnb = await deployContract("PancakePair", [])
        await btcBnb.setReserves(expandDecimals(10, 18), expandDecimals(2000, 18))
        await vaultPricefeed.functions.setTokens(toAsset(BTC), eth.address, toAsset(BNB)).call()
        await vaultPricefeed.functions.setPairs(bnbBusd.address, ethBnb.address, btcBnb.address).call()
        await vaultPricefeed.functions.set_is_amm_enabled(false).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true))).eq(toNormalizedPrice(600))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BTC), false, true, true))).eq(toNormalizedPrice(80000))
        await vaultPricefeed.functions.set_is_amm_enabled(true).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true))).eq(toNormalizedPrice(300))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BTC), false, true, true))).eq(toNormalizedPrice(60000))
        await vaultPricefeed.functions.set_is_amm_enabled(false).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true))).eq(toNormalizedPrice(600))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BTC), false, true, true))).eq(toNormalizedPrice(80000))
        await vaultPricefeed.functions.set_is_amm_enabled(true).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(200)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true))).eq(toNormalizedPrice(200))
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BTC), false, true, true))).eq(toNormalizedPrice(50000))
        await BNBPricefeed.functions.set_latest_answer(toPrice(250)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true))).eq(toNormalizedPrice(200))
        await BNBPricefeed.functions.set_latest_answer(toPrice(280)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), true, true, true))).eq(toNormalizedPrice(300))
        await vaultPricefeed.functions.set_spread_basis_points(toAsset(BNB), 20).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true))).eq(toNormalizedPrice(199.6))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), true, true, true))).eq(toNormalizedPrice(300.6))
        await vaultPricefeed.functions.set_use_v2_pricing(true).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(301)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(302)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(303)).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true))).eq(toNormalizedPrice(299.4))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), true, true, true))).eq(toNormalizedPrice(303.606))
        await vaultPricefeed.functions.set_spread_threshold_basis_points(90).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true)))
            .eq(toNormalizedPrice(299.4))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), true, true, true)))
            .eq(toNormalizedPrice(303.606))
        await vaultPricefeed.functions.set_spread_threshold_basis_points(100).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true)))
            .eq(toNormalizedPrice(299.4))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), true, true, true)))
            .eq(toNormalizedPrice(300.6))
        await vaultPricefeed.functions.set_favor_primary_price(true).call()
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), false, true, true)))
            .eq(toNormalizedPrice(300.398))
        expect(await getValStr(vaultPricefeed.functions.get_price(toAsset(BNB), true, true, true)))
            .eq(toNormalizedPrice(303.606))
    })
    */
})
