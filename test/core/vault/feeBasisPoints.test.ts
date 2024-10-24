import { expect, use } from "chai"
import { AbstractContract, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    Fungible,
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
import { deploy, getValStr, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../../utils/account"
import { toPrice, toUsd } from "../../utils/units"
import { getAssetId, toAsset } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BNB_MAX_LEVERAGE, DAI_MAX_LEVERAGE, getBnbConfig, getDaiConfig } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.getFeeBasisPoints", function () {
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

        await call(
            vaultStorage.functions.set_fees(
                50, // _taxBasisPoints
                10, // _stableTaxBasisPoints
                20, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                0, // _minProfitTime
                true, // _hasDynamicFees
            ),
        )
    })

    it("getFeeBasisPoints", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))
        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(BNB)))).eq("0")

        await call(BNB.functions.mint(addrToAccount(user0), 100))
        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(deployer))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [100, getAssetId(BNB)],
                }),
        )

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(BNB)))).eq("29700")

        // rusdAmount(bnb) is 29700, targetAmount(bnb) is 29700
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, true))).eq("100")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, true))).eq("104")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 100, 50, false))).eq("100")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 100, 50, false))).eq("104")

        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 50, 100, true))).eq("51")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 50, 100, true))).eq("58")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 1000, 50, 100, false))).eq("51")
        expect(await getValStr(vaultUtils.functions.get_fee_basis_points(toAsset(BNB), 5000, 50, 100, false))).eq("58")

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(BNB)))).eq("14850")
        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(DAI)))).eq("14850")

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

        await call(DAI.functions.mint(addrToAccount(user0), 20000))
        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(deployer))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [20000, getAssetId(DAI)],
                }),
        )

        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(BNB)))).eq("24850")
        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(DAI)))).eq("24850")

        const bnbConfig = getBnbConfig(BNB)
        bnbConfig[2] = 30000
        await call(vaultStorage.functions.set_asset_config(...bnbConfig))

        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(BNB)))).eq("37275")
        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(DAI)))).eq("12425")

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
        await call(vaultStorage.functions.set_asset_config(...bnbConfig))

        await call(BNB.functions.mint(addrToAccount(user0), 200))
        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(deployer))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [200, getAssetId(BNB)],
                }),
        )

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("89100")
        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(BNB)))).eq("36366")
        expect(await getValStr(vaultStorage.functions.get_target_rusd_amount(toAsset(DAI)))).eq("72733")

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
