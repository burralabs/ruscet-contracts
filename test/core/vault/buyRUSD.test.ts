import { expect, use } from "chai"
import { AbstractContract, BN, FUEL_NETWORK_URL, Provider, Wallet, WalletUnlocked } from "fuels"
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

describe("Vault.buyRUSD", () => {
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
        // toPrice(51108)
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
        await vault.functions
            .initialize(addrToAccount(deployer), toContract(vaultUtils), toContract(vaultStorage))
            .addContracts(attachedContracts)
            .call()
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

    it("buyRUSD", async () => {
        await expect(
            vault.functions.buy_rusd(toAsset(BNB), addrToAccount(deployer)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultAssetNotWhitelisted")

        await expect(
            vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultAssetNotWhitelisted")

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await expect(
            vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultInvalidAssetAmount")

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await BNB.functions.mint(addrToAccount(user0), 100).call()
        await transfer(BNB.connect(user0), contrToAccount(vault), 100)
        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("29700")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BNB)

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("29700") // 29700 with asset decimals = 18
    })

    it("buyRUSD allows gov to mint", async () => {
        await vaultStorage.functions.set_in_manager_mode(true).call()
        await expect(
            vault.functions.buy_rusd(toAsset(BNB), addrToAccount(deployer)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultForbiddenNotManager")

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await BNB.functions.mint(addrToAccount(deployer.address), 100).call()
        await transfer(BNB, contrToAccount(vault), 100)

        expect(await getBalance(deployer, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await expect(
            vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(deployer)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultForbiddenNotManager")

        await vaultStorage.functions.set_manager(addrToAccount(user0), true).call()
        await vault
            .connect(user0)
            .functions.buy_rusd(toAsset(BNB), addrToAccount(deployer))
            .addContracts(attachedContracts)
            .call()

        expect(await getBalance(deployer, RUSD)).eq("29700")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD uses min price", async () => {
        await expect(
            vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultAssetNotWhitelisted")

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(200)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(250)).call()

        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        await BNB.functions.mint(addrToAccount(user0), 100).call()
        await transfer(BNB.connect(user0), contrToAccount(vault), 100)
        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()
        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("19800")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("19800")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD updates fees", async () => {
        await expect(
            vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultAssetNotWhitelisted")

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        await BNB.functions.mint(addrToAccount(user0), 10000).call()
        await transfer(BNB.connect(user0), contrToAccount(vault), 10000)
        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq(asStr(9970 * 300))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("30")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq(asStr(9970 * 300))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(10000 - 30))

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD uses mintBurnFeeBasisPoints", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

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

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        await DAI.functions.mint(addrToAccount(user0), expandDecimals(10000)).call()
        await transfer(DAI.connect(user0), contrToAccount(vault), expandDecimals(10000))
        await vault.connect(user0).functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq(expandDecimals(10000 - 4, 8))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq(expandDecimals(4, 8))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq(expandDecimals(10000 - 4, 8))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq(expandDecimals(10000 - 4, 8))
    })

    it("buyRUSD adjusts for decimals", async () => {
        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await expect(
            vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call(),
        ).to.be.revertedWith("VaultInvalidAssetAmount")

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(BTC.connect(user0), contrToAccount(vault), expandDecimals(1))
        await vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("300000")
        expect(await getBalance(user1, RUSD)).eq(BigNumber.from(expandDecimals(60000, 8)).sub(expandDecimals(180, 8)).toString()) // 0.3% of 60,000 => 180
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq(
            BigNumber.from(expandDecimals(60000, 8)).sub(expandDecimals(180, 8)).toString(),
        )
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            BigNumber.from(expandDecimals(1, 8)).sub(300000).toString(),
        )

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })
})
