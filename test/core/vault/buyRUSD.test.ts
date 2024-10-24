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
import { BigNumber } from "ethers"
import {
    BNB_MAX_LEVERAGE,
    BTC_MAX_LEVERAGE,
    getBnbConfig,
    getBtcConfig,
    getDaiConfig,
    validateVaultRouterBalance,
} from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.buyRUSD", () => {
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

    it("buyRUSD", async () => {
        await expect(
            call(vaultRouter.functions.buy_rusd(toAsset(BNB), addrToAccount(deployer)).addContracts(attachedContracts)),
        ).to.be.revertedWith("VaultRouterAssetNotWhitelisted")

        await expect(
            call(
                vaultRouter.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterAssetNotWhitelisted")

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        await expect(
            call(
                vaultRouter.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterInvalidAssetAmount")

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(BNB.functions.mint(addrToAccount(user0), 100))
        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [100, getAssetId(BNB)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("29700")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD allows gov to mint", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        await call(BNB.functions.mint(addrToAccount(deployer.address), 100))

        expect(await getBalance(deployer, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(
            vaultRouter.functions
                .buy_rusd(toAsset(BNB), addrToAccount(deployer))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [100, getAssetId(BNB)],
                }),
        )

        expect(await getBalance(deployer, RUSD)).eq("29700")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("29700")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD uses min price", async () => {
        await expect(
            call(
                vaultRouter.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterAssetNotWhitelisted")

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(200)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(250)))

        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        await call(BNB.functions.mint(addrToAccount(user0), 100))
        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [100, getAssetId(BNB)],
                }),
        )
        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("19800")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("1")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("19800")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(100 - 1))

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD updates fees", async () => {
        await expect(
            call(
                vaultRouter.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterAssetNotWhitelisted")

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        await call(BNB.functions.mint(addrToAccount(user0), 10000))
        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [10000, getAssetId(BNB)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq(asStr(9970 * 300))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("30")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq(asStr(9970 * 300))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq(asStr(10000 - 30))

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD uses mintBurnFeeBasisPoints", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

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

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(10000)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(10000), getAssetId(DAI)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq(expandDecimals(10000 - 4))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq(expandDecimals(4))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq(expandDecimals(10000 - 4))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq(expandDecimals(10000 - 4))
    })

    it("buyRUSD adjusts for decimals", async () => {
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await expect(
            call(
                vaultRouter.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterInvalidAssetAmount")

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(1), getAssetId(BTC)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("300000")
        expect(await getBalance(user1, RUSD)).eq(BigNumber.from(expandDecimals(60000)).sub(expandDecimals(180)).toString()) // 0.3% of 60,000 => 180
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq(
            BigNumber.from(expandDecimals(60000)).sub(expandDecimals(180)).toString(),
        )
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            BigNumber.from(expandDecimals(1)).sub(300000).toString(),
        )

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })
})
