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
import { getBnbConfig, getBtcConfig, getDaiConfig } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"

use(useChai)

describe("Vault.sellRUSD", function () {
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
    let RUSD: string // the RUSD fungible asset
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

        RUSD = getAssetId(rusd)

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

    it("sellRUSD", async () => {
        await expect(
            vault.connect(user0).functions.sell_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultAssetNotWhitelisted")

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BNB.functions.mint(addrToAccount(user0), 100).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("0")
        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        expect(await getBalance(user0, BNB)).eq("100")

        await transfer(BNB.as(user0), contrToAccount(vault), 100)
        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user0)).addContracts(attachedContracts).call()

        expect(await getBalance(user0, RUSD)).eq("29700")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))
        expect(await getBalance(user0, BNB)).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("29700")

        await expect(
            vault.connect(user0).functions.sell_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultInvalidRusdAmount")

        await transfer(rusd.as(user0) as any, contrToAccount(vault), 15000)

        await expect(
            vault.connect(user0).functions.sell_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultInvalidRedemptionAmount")

        await vaultStorage.functions.set_in_manager_mode(true).call()
        await expect(
            vault.connect(user0).functions.sell_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultForbiddenNotManager")

        await vaultStorage.functions.set_manager(addrToAccount(user0), true).call()

        await vault.connect(user0).functions.sell_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()
        expect(await getBalance(user0, RUSD)).eq(asStr(29700 - 15000))
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("2")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq(asStr(29700 - 15000))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1 - 50))
        expect(await getBalance(user0, BNB)).eq("0")
        expect(await getBalance(user1, BNB)).eq(asStr(50 - 1)) // (15000 / 300) => 50
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq(asStr(29700 - 15000))
    })

    it("sellRUSD after a price increase", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await BNB.functions.mint(addrToAccount(user0), 100).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("0")
        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        expect(await getBalance(user0, BNB)).eq("100")
        await transfer(BNB.as(user0), contrToAccount(vault), 100)
        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user0)).addContracts(attachedContracts).call()

        expect(await getBalance(user0, RUSD)).eq("29700")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))
        expect(await getBalance(user0, BNB)).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("29700")

        await BNBPricefeed.functions.set_latest_answer(toPrice(400)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(600)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("39600")

        await transfer(rusd.as(user0) as any, contrToAccount(vault), 15000)
        await vault.connect(user0).functions.sell_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getBalance(user0, RUSD)).eq(asStr(29700 - 15000))
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("2")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq(asStr(29700 - 15000))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1 - 25))
        expect(await getBalance(user0, BNB)).eq("0")
        expect(await getBalance(user1, BNB)).eq(asStr(25 - 1)) // (15000 / 600) => 25
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("29600")
    })

    it("sellRUSD redeem based on price", async () => {
        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)).call()

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("0")
        expect(await getBalance(user0, BTC)).eq(expandDecimals(2, 8))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("0")
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))
        await vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user0)).addContracts(attachedContracts).call()
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("11964000000000") // 119,640

        expect(await getBalance(user0, RUSD)).eq("11964000000000") // 119,640
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("600000") // 0.006 BTC, 2 * 0.03%
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("11964000000000") // 119,640
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("199400000") // 1.994 BTC
        expect(await getBalance(user0, BTC)).eq("0")
        expect(await getBalance(user1, BTC)).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(82000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(80000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(83000)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq(expandDecimals(159520)) // 199400000 / (10 ** 8) * 80,000
        await transfer(rusd.as(user0) as any, contrToAccount(vault), expandDecimals(10000))
        await vault.connect(user0).functions.sell_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getBalance(user1, BTC)).eq("12012047") // 0.12012047 BTC, 0.12012047 * 83000 => 9969.999
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("636145") // 0.00636145
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("187351808") // 199400000-(636145-600000)-12012047 => 187351808
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("14988144640000") // 149881.4464, 187351808 / (10 ** 8) * 80,000
    })

    /*
    it("sellRUSD for stableTokens", async () => {
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

        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(10000, 18)).call()

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("0")
        expect(await getBalance(user0, DAI)).eq(expandDecimals(10000, 18))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("0")

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(10000, 18))
        await vault.connect(user0).functions.buy_rusd(toAsset(DAI), addrToAccount(user0)).addContracts(attachedContracts).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq(expandDecimals(9996, 18))
        expect(await getBalance(user0, RUSD)).eq(expandDecimals(9996, 18))
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq(expandDecimals(4, 18))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq(expandDecimals(9996, 18))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq(expandDecimals(9996, 18))
        expect(await getBalance(user0, DAI)).eq("0")
        expect(await getBalance(user1, DAI)).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(5000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()

        expect(await getBalance(user2, DAI)).eq("0")

        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(1, 8))
        await vault.connect(user0).swap(toAsset(BTC), toAsset(DAI), user2.address).addContracts(attachedContracts).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq(expandDecimals(9996, 18))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq(expandDecimals(19, 18))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq(expandDecimals(4996, 18))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq(expandDecimals(4996, 18))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq(expandDecimals(5000, 18))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(expandDecimals(1, 8))

        expect(await getBalance(user2, DAI)).eq(expandDecimals(4985, 18))

        await rusd.connect(user0).approve(router.address, expandDecimals(5000, 18))
        await expect(
            router.connect(user0).swap([rusd.address, toAsset(DAI)], expandDecimals(5000, 18), 0, user3.address),
        ).to.be.revertedWith("VaultPoolAmountExceeded")

        expect(await getBalance(user3, DAI)).eq("0")
        await router.connect(user0).swap([rusd.address, toAsset(DAI)], expandDecimals(4000, 18), 0, user3.address)
        expect(await getBalance(user3, DAI)).eq("3998400000000000000000") // 3998.4

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("20600000000000000000") // 20.6
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq(expandDecimals(996, 18))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq(expandDecimals(996, 18))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq(expandDecimals(5996, 18))
    })
    */
})
