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
import { deploy, formatObj, getValStr, getValue, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd } from "../../utils/units"
import { getAssetId, toAsset } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BTC_MAX_LEVERAGE, getBtcConfig, validateVaultRouterBalance } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPosition, getPositionLeverage } from "../../utils/contract"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.depositCollateral", () => {
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

    it("deposit collateral", async () => {
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(47), true)
                .callParams({
                    // 0.001174 BTC => 47
                    forward: [117500 - 1, getAssetId(BTC)],
                })
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("0")

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq("0")
        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    // 0.001174 BTC => 47
                    forward: [117500 - 1, getAssetId(BTC)],
                }),
        )
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd("46.8584"))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("353") // (117500 - 1) * 0.3% => 353
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("4685840000") // (117500 - 1 - 353) * 40000
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(117500 - 1 - 353))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(100), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [117500 - 1, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [117500 - 1, getAssetId(BTC)],
                }),
        )

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd("93.7168"))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2)) // (117500 - 1) * 0.3% * 2
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr((117500 - 1 - 353) * 2))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(47), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultRouterInsufficientCollateralForFees")

        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq("0") // size
        expect(position.collateral).eq("0") // collateral
        expect(position.average_price).eq("0") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("0") // reserveAmount

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(47), true)
                .callParams({
                    forward: [22500, getAssetId(BTC)],
                })
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(256792 - 114))
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("117500")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(38.047))
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(BTC)))).eq(toUsd(92.79)) // (256792 - 117500) sats * 40000 => 51.7968, 47 / 40000 * 41000 => ~45.8536

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(47)) // size
        expect(position.collateral).eq(toUsd(8.953)) // collateral, 0.000225 BTC => 9, DECIMALS - 0.047 => 8.953
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("117500") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2 + 114)) // fee is 0.047 USD => 0.00000114 BTC
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr((117500 - 1 - 353) * 2 + 22500 - 114),
        )

        let leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)

        expect(leverage).eq("52496") // ~5.2x

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, true)
                .callParams({
                    forward: [22500, getAssetId(BTC)],
                })
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(47)) // size
        expect(position.collateral).eq(toUsd(8.953 + 9)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("117500") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2 + 114)) // fee is 0.047 USD => 0.00000114 BTC
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr((117500 - 1 - 353) * 2 + 22500 + 22500 - 114),
        )

        leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)

        expect(leverage).eq("26179") // ~2.6x

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(51000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [100, getAssetId(BTC)],
                }),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(47)) // size
        expect(position.collateral).eq(toUsd(8.953 + 9 + 0.05)) // collateral
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("117500") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(353 * 2 + 114)) // fee is 0.047 USD => 0.00000114 BTC
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("9371680000") // (117500 - 1 - 353) * 40000 * 2
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr((117500 - 1 - 353) * 2 + 22500 + 22500 + 100 - 114),
        )

        leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)

        expect(leverage).eq("26106") // ~2.6x

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })
})
