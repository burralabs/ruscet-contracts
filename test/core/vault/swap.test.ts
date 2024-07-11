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

describe("Vault.functions.swap", function () {
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let utils: UtilsAbi
    let BNB: FungibleAbi
    let BNBPricefeed: PricefeedAbi
    let ETH: FungibleAbi
    let ETHPricefeed: PricefeedAbi
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

        ETH = (await deploy("Fungible", deployer)) as FungibleAbi
        ETHPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        BTC = (await deploy("Fungible", deployer)) as FungibleAbi
        BTCPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        await BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed").call()
        await ETHPricefeed.functions.initialize(addrToAccount(deployer), "ETH Pricefeed").call()
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
        await vaultPricefeed.functions.set_asset_config(toAsset(ETH), toContract(ETHPricefeed), 8, false).call()
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

    it("swap", async () => {
        await expect(
            vault
                .connect(user1)
                .functions.swap(toAsset(BNB), toAsset(BTC), addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultAssetInNotWhitelisted")

        await vaultStorage.functions.set_is_swap_enabled(false).call()

        await expect(
            vault
                .connect(user1)
                .functions.swap(toAsset(BNB), toAsset(BTC), addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultSwapsNotEnabled")

        await vaultStorage.functions.set_is_swap_enabled(true).call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await expect(
            vault
                .connect(user1)
                .functions.swap(toAsset(BNB), toAsset(BTC), addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultAssetOutNotWhitelisted")

        await expect(
            vault
                .connect(user1)
                .functions.swap(toAsset(BNB), toAsset(BNB), addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultAssetsAreEqual")

        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(200, 8)).call()
        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("0")

        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(200, 8))
        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user0)).addContracts(attachedContracts).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq(expandDecimals(59820, 8)) // 60,000 * 99.7%

        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(1, 8))
        await vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user0)).addContracts(attachedContracts).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq(expandDecimals(119640, 8)) // 59,820 + (60,000 * 99.7%)

        expect(await getBalance(user0, RUSD)).eq(BigNumber.from(expandDecimals(120000, 8)).sub(expandDecimals(360, 8)).toString()) // 120,000 * 0.3% => 360

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("60000000") // 200 * 0.3% => 0.6
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq(
            BigNumber.from(expandDecimals(200 * 300, 8))
                .sub(expandDecimals(180, 8))
                .toString(),
        ) // 60,000 * 0.3% => 180
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(
            BigNumber.from(expandDecimals(200, 8)).sub("60000000").toString(),
        )

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("300000") // 1 * 0.3% => 0.003
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq(
            BigNumber.from(expandDecimals(200 * 300, 8))
                .sub(expandDecimals(180, 8))
                .toString(),
        )
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            BigNumber.from(expandDecimals(1, 8)).sub("300000").toString(),
        )

        await BNBPricefeed.functions.set_latest_answer(toPrice(400)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(600)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq(expandDecimals(139580, 8)) // 59,820 / 300 * 400 + 59820

        await BTCPricefeed.functions.set_latest_answer(toPrice(90000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(100000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(80000)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq(expandDecimals(159520, 8)) // 59,820 / 300 * 400 + 59820 / 60000 * 80000

        await BNB.functions.mint(addrToAccount(user1), expandDecimals(100, 8)).call()
        await transfer(BNB.as(user1), contrToAccount(vault), expandDecimals(100, 8))

        expect(await getBalance(user1, BTC)).eq("0")
        expect(await getBalance(user2, BTC)).eq("0")
        await vault
            .connect(user1)
            .functions.swap(toAsset(BNB), toAsset(BTC), addrToAccount(user2))
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq(expandDecimals(167520, 8)) // 159520 + (100 * 400) - 32000

        expect(await getBalance(user1, BTC)).eq("0")
        expect(await getBalance(user2, BTC)).eq(BigNumber.from(expandDecimals(4, 7)).sub("120000").toString()) // 0.8 - 0.0012

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("60000000") // 200 * 0.3% => 0.6
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq(
            BigNumber.from(expandDecimals(100 * 400, 8))
                .add(expandDecimals(200 * 300, 8))
                .sub(expandDecimals(180, 8))
                .toString(),
        )
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(
            BigNumber.from(expandDecimals(100, 8)).add(expandDecimals(200, 8)).sub("60000000").toString(),
        )

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("420000") // 1 * 0.3% => 0.003, 0.4 * 0.3% => 0.0012
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq(
            BigNumber.from(expandDecimals(200 * 300, 8))
                .sub(expandDecimals(180, 8))
                .sub(expandDecimals(100 * 400, 8))
                .toString(),
        )
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            BigNumber.from(expandDecimals(1, 8)).sub("300000").sub(expandDecimals(4, 7)).toString(),
        ) // 59700000, 0.597 BTC, 0.597 * 100,000 => 59700

        await BNBPricefeed.functions.set_latest_answer(toPrice(400)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(450)).call()

        expect(await getBalance(user0, BNB)).eq("0")
        expect(await getBalance(user3, BNB)).eq("0")
        await transfer(rusd.as(user0) as any, contrToAccount(vault), expandDecimals(50000))
        await vault.functions.sell_rusd(toAsset(BNB), addrToAccount(user3)).addContracts(attachedContracts).call()
        expect(await getBalance(user0, BNB)).eq("0")
        expect(await getBalance(user3, BNB)).eq("9970000000") // 99.7, 50000 / 500 * 99.7%

        await transfer(rusd.as(user0) as any, contrToAccount(vault), expandDecimals(50000, 8))
        await vault.functions.sell_rusd(toAsset(BTC), addrToAccount(user3)).addContracts(attachedContracts).call()

        await transfer(rusd.as(user0) as any, contrToAccount(vault), expandDecimals(10000, 8))
        await expect(
            vault.functions.sell_rusd(toAsset(BTC), addrToAccount(user3)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultPoolAmountExceeded")
    })

    it("caps max RUSD amount", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(600)).call()
        await ETHPricefeed.functions.set_latest_answer(toPrice(3000)).call()

        const bnbConfig = getBnbConfig(BNB)
        const ETHConfig = getBnbConfig(ETH)

        bnbConfig[4] = expandDecimals(299000, 8)
        await vaultStorage.functions.set_asset_config(...bnbConfig).call()

        ETHConfig[4] = expandDecimals(30000, 8)
        await vaultStorage.functions.set_asset_config(...ETHConfig).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(499, 8)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(499, 8))
        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user0)).addContracts(attachedContracts).call()

        await ETH.functions.mint(addrToAccount(user0), expandDecimals(10, 8)).call()
        await transfer(ETH.as(user0), contrToAccount(vault), expandDecimals(10, 8))
        await vault.connect(user0).functions.buy_rusd(toAsset(ETH), addrToAccount(user1)).addContracts(attachedContracts).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(1, 8))

        await expect(
            vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user0)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultMaxRusdExceeded")

        bnbConfig[4] = expandDecimals(299100, 8)
        await vaultStorage.functions.set_asset_config(...bnbConfig).call()

        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user0)).addContracts(attachedContracts).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(1, 8))
        await expect(
            vault
                .connect(user0)
                .functions.swap(toAsset(BNB), toAsset(ETH), addrToAccount(user1))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultMaxRusdExceeded")

        bnbConfig[4] = expandDecimals(299700, 8)
        await vaultStorage.functions.set_asset_config(...bnbConfig).call()
        await vault
            .connect(user0)
            .functions.swap(toAsset(BNB), toAsset(ETH), addrToAccount(user1))
            .addContracts(attachedContracts)
            .call()
    })

    it("does not cap max RUSD debt", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(600)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await ETHPricefeed.functions.set_latest_answer(toPrice(3000)).call()
        await vaultStorage.functions.set_asset_config(...getEthConfig(ETH)).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(100, 8)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(100, 8))
        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user0)).addContracts(attachedContracts).call()

        await ETH.functions.mint(addrToAccount(user0), expandDecimals(10, 8)).call()

        expect(await getBalance(user0, ETH)).eq(expandDecimals(10, 8))
        expect(await getBalance(user1, BNB)).eq("0")

        await transfer(ETH.as(user0), contrToAccount(vault), expandDecimals(10, 8))
        await vault
            .connect(user0)
            .functions.swap(toAsset(ETH), toAsset(BNB), addrToAccount(user1))
            .addContracts(attachedContracts)
            .call()

        expect(await getBalance(user0, ETH)).eq("0")
        expect(await getBalance(user1, BNB)).eq("4985000000")

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()

        await ETH.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(ETH.as(user0), contrToAccount(vault), expandDecimals(1, 8))
        await vault
            .connect(user0)
            .functions.swap(toAsset(ETH), toAsset(BNB), addrToAccount(user1))
            .addContracts(attachedContracts)
            .call()
    })

    it("ensures poolAmount >= buffer", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(600)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await ETHPricefeed.functions.set_latest_answer(toPrice(3000)).call()
        await vaultStorage.functions.set_asset_config(...getEthConfig(ETH)).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(100, 8)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(100, 8))
        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user0)).addContracts(attachedContracts).call()

        await vaultStorage.functions.set_buffer_amount(toAsset(BNB), "9470000000").call() // 94.7

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("9970000000") // 99.7
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(ETH)))).eq("0")
        expect(await getBalance(user1, BNB)).eq("0")
        expect(await getBalance(user1, ETH)).eq("0")

        await ETH.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(ETH.as(user0), contrToAccount(vault), expandDecimals(1, 8))
        await vault
            .connect(user0)
            .functions.swap(toAsset(ETH), toAsset(BNB), addrToAccount(user1))
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("9470000000") // 94.7
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(ETH)))).eq(expandDecimals(1, 8))
        expect(await getBalance(user1, BNB)).eq("498500000") // 4.985
        expect(await getBalance(user1, ETH)).eq("0")

        await ETH.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(ETH.as(user0), contrToAccount(vault), expandDecimals(1, 8))
        await expect(
            vault
                .connect(user0)
                .functions.swap(toAsset(ETH), toAsset(BNB), addrToAccount(user1))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultPoolAmountLtBuffer")
    })
})
