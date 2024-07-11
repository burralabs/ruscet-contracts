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

describe("Vault.getFeeBasisPoints", function () {
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

        await vaultStorage.functions
            .set_fees(
                50, // _taxBasisPoints
                10, // _stableTaxBasisPoints
                20, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                0, // _minProfitTime
                true, // _hasDynamicFees
            )
            .call()
    })

    it("getFeeBasisPoints", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()
        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(BNB)))).eq("0")

        await BNB.functions.mint(contrToAccount(vault), 100).call()
        await vault
            .connect(user0)
            .functions.buy_rusd(toAsset(BNB), addrToAccount(deployer))
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(BNB)))).eq("29700")

        // rusdAmount(bnb) is 29700, targetAmount(bnb) is 29700
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, true))).eq("100")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, true))).eq("104")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, false))).eq("100")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, false))).eq("104")

        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 50, 100, true))).eq("51")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 50, 100, true))).eq("58")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 50, 100, false))).eq("51")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 50, 100, false))).eq("58")

        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(BNB)))).eq("14850")
        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(DAI)))).eq("14850")

        // rusdAmount(bnb) is 29700, targetAmount(bnb) is 14850
        // incrementing bnb has an increased fee, while reducing bnb has a decreased fee
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 10000, 100, 50, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 20000, 100, 50, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, false))).eq("50")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, false))).eq("50")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 10000, 100, 50, false))).eq("50")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 20000, 100, 50, false))).eq("50")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 25000, 100, 50, false))).eq("50")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 100000, 100, 50, false))).eq("150")

        await DAI.functions.mint(contrToAccount(vault), 20000).call()
        await vault
            .connect(user0)
            .functions.buy_rusd(toAsset(DAI), addrToAccount(deployer))
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(BNB)))).eq("24850")
        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(DAI)))).eq("24850")

        const bnbConfig = getBnbConfig(BNB)
        bnbConfig[2] = 30000
        await vaultStorage.functions.set_asset_config(...bnbConfig).call()

        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(BNB)))).eq("37275")
        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(DAI)))).eq("12425")

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")

        // rusdAmount(bnb) is 29700, targetAmount(bnb) is 37270
        // incrementing bnb has a decreased fee, while reducing bnb has an increased fee
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, true))).eq("90")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, true))).eq("90")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 10000, 100, 50, true))).eq("90")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, false))).eq("110")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, false))).eq("113")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 10000, 100, 50, false))).eq("116")

        bnbConfig[2] = 5000
        await vaultStorage.functions.set_asset_config(...bnbConfig).call()

        await BNB.functions.mint(contrToAccount(vault), 200).call()
        await vault
            .connect(user0)
            .functions.buy_rusd(toAsset(BNB), addrToAccount(deployer))
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("89100")
        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(BNB)))).eq("36366")
        expect(await getValStr(vaultUtils.functions.get_target_rusd_amount(toAsset(DAI)))).eq("72733")

        // rusdAmount(bnb) is 88800, targetAmount(bnb) is 36266
        // incrementing bnb has an increased fee, while reducing bnb has a decreased fee
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 10000, 100, 50, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, false))).eq("28")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, false))).eq("28")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 20000, 100, 50, false))).eq("28")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 50000, 100, 50, false))).eq("28")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 80000, 100, 50, false))).eq("28")

        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 50, 100, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 50, 100, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 10000, 50, 100, true))).eq("150")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 50, 100, false))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 50, 100, false))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 20000, 50, 100, false))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 50000, 50, 100, false))).eq("0")
    })
})
