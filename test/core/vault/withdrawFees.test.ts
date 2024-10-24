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
import { deploy, getBalance, getValStr, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../../utils/account"
import { expandDecimals, toPrice, toUsd } from "../../utils/units"
import { getAssetId, toAsset } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BNB_MAX_LEVERAGE, BTC_MAX_LEVERAGE, getBnbConfig, getBtcConfig } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.withdrawFees", function () {
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
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
    let utils: Utils

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
    })

    it("withdrawFees", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BNB), BNB_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(900)))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(900), getAssetId(BNB)],
                }),
        )

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("26919000000000") // 269,190 RUSD, 810 fee
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("270000000") // 2.7, DECIMALS00 * 0.3%
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3
        expect(await getValStr(rusd.functions.total_supply())).eq("26919000000000")

        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(200)))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(2)))

        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(2), getAssetId(BTC)],
                }),
        )

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("11964000000000") // 119,640
        expect(await getValStr(rusd.functions.total_supply())).eq("38883000000000") // 388,830

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(2)))

        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(2), getAssetId(BTC)],
                }),
        )
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("23928000000000") // 239,280
        expect(await getValStr(rusd.functions.total_supply())).eq("50847000000000") // 508,470

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3

        await call(
            vaultRouter
                .connect(user0)
                .functions.buy_rusd(toAsset(BNB), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [expandDecimals(200), getAssetId(BNB)],
                }),
        )

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("32901000000000") // 329,010
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("109670000000") // 1096.7

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("330000000") // 3.3 BNB
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("1200000") // 0.012 BTC

        await expect(
            vaultRouter.connect(user0).functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).call(),
        ).to.be.revertedWith("VaultRouterForbiddenNotGov")

        expect(await getBalance(user2, BNB)).eq("0")
        await call(vaultRouter.functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).addContracts(attachedContracts))
        expect(await getBalance(user2, BNB)).eq("330000000")

        expect(await getBalance(user2, BTC)).eq("0")
        await call(vaultRouter.functions.withdraw_fees(toAsset(BTC), addrToAccount(user2)).addContracts(attachedContracts))
        expect(await getBalance(user2, BTC)).eq("1200000")
    })
})
