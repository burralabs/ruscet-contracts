import { expect, use } from "chai"
import { AbstractContract, BN, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    Fungible,
    Rlp,
    Pricefeed,
    TimeDistributor,
    Rusd,
    Utils,
    Vault,
    VaultPricefeed,
    VaultStorage,
    VaultUtils,
    YieldTracker,
} from "../../../types"
import { deploy, getBalance, getValue, getValStr, formatObj, call } from "../../utils/utils"
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
    let utils: Utils
    let BNB: Fungible
    let BNBPricefeed: Pricefeed
    let DAI: Fungible
    let DAIPricefeed: Pricefeed
    let BTC: Fungible
    let BTCPricefeed: Pricefeed
    let vault: Vault
    let vaultStorage: VaultStorage
    let vaultUtils: VaultUtils
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
            Vault + Router + RUSD
        */
        utils = await deploy("Utils", deployer)
        vaultStorage = await deploy("VaultStorage", deployer)
        vaultUtils = await deploy("VaultUtils", deployer)
        vault = await deploy("Vault", deployer, {
            VAULT_STORAGE: toContract(vaultStorage),
            VAULT_UTILS: toContract(vaultUtils),
        })
        vaultPricefeed = await deploy("VaultPricefeed", deployer)
        rusd = await deploy("Rusd", deployer)
        timeDistributor = await deploy("TimeDistributor", deployer)
        yieldTracker = await deploy("YieldTracker", deployer)
        rlp = await deploy("Rlp", deployer)
        attachedContracts = [vaultUtils, vaultStorage]

        RUSD = getAssetId(rusd)

        await call(rusd.functions.initialize(toContract(vault)))

        await call(
            vaultStorage.functions.initialize(
                addrToAccount(deployer),
                toContract(rusd),
                toAsset(rusd), // RUSD native asset
                toContract(rusd), // RUSD contract
                toContract(vaultPricefeed),
                toUsd(5), // liquidationFeeUsd
                600, // fundingRateFactor
                600, // stableFundingRateFactor
            ),
        )
        await call(vaultUtils.functions.initialize(addrToAccount(deployer), toContract(vault), toContract(vaultStorage)))
        await call(vault.functions.initialize(addrToAccount(deployer)).addContracts(attachedContracts))
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

        await call(rlp.functions.initialize())
    })

    it("buyRUSD", async () => {
        await expect(
            call(vault.functions.buy_rusd(toAsset(BNB), addrToAccount(deployer)).addContracts(attachedContracts)),
        ).to.be.revertedWith("VaultAssetNotWhitelisted")

        await expect(
            call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts)),
        ).to.be.revertedWith("VaultAssetNotWhitelisted")

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await expect(
            call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts)),
        ).to.be.revertedWith("VaultInvalidAssetAmount")

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(BNB.functions.mint(addrToAccount(user0), 100))
        await call(
            vault
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

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD allows gov to mint", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await call(BNB.functions.mint(addrToAccount(deployer.address), 100))

        expect(await getBalance(deployer, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(vaultStorage.functions.set_manager(addrToAccount(user0), true))
        await call(
            vault.functions
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

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD uses min price", async () => {
        await expect(
            call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts)),
        ).to.be.revertedWith("VaultAssetNotWhitelisted")

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(200)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(250)))

        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        await call(BNB.functions.mint(addrToAccount(user0), 100))
        await call(
            vault
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

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BNB)
    })

    it("buyRUSD updates fees", async () => {
        await expect(
            call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts)),
        ).to.be.revertedWith("VaultAssetNotWhitelisted")

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")
        await call(BNB.functions.mint(addrToAccount(user0), 10000))
        await call(
            vault
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

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BNB)
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
            vault
                .connect(user0)
                .functions.buy_rusd(toAsset(DAI), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(10000), getAssetId(DAI)],
                }),
        )

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq(expandDecimals(10000 - 4, 8))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq(expandDecimals(4, 8))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq(expandDecimals(10000 - 4, 8))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq(expandDecimals(10000 - 4, 8))
    })

    it("buyRUSD adjusts for decimals", async () => {
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await expect(
            call(vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts)),
        ).to.be.revertedWith("VaultInvalidAssetAmount")

        expect(await getBalance(user0, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)))
        await call(
            vault
                .connect(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(1, 8), getAssetId(BTC)],
                }),
        )

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
