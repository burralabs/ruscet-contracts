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
import { deploy, getBalance, getValue, getValStr, formatObj, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd } from "../../utils/units"
import { getAssetId, toAsset } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BTC_MAX_LEVERAGE, DAI_MAX_LEVERAGE, getBtcConfig, getDaiConfig, validateVaultRouterBalance } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPosition } from "../../utils/contract"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.closeLongPosition", () => {
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

    it("close long position", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [250000, getAssetId(BTC)],
                }),
        )

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))

        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(46100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(47100)))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(9))

        await call(
            vaultRouter
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    toUsd(4),
                    toUsd(90),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq("0") // size
        expect(position.collateral).eq("0") // collateral
        expect(position.average_price).eq("0") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("0") // reserveAmount, 0.00225 * 40,000 => 90
        expect(position.realized_pnl.value).eq("0") // pnl
        expect(position.realized_pnl.is_neg).eq(false)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 191)) // 0.00000191 * 47100 => ~0.09 USD
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 39957 - 191)) // 0.00040148 * 47100 => ~18.9 USD
        expect(await getBalance(user2 as any, BTC)).eq("39957") // 0.00039957 * 47100 => 18.82 USD

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })

    it("close long position with loss", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [250000, getAssetId(BTC)],
                }),
        )

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await expect(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                })
                .call(),
        ).to.be.revertedWith("VaultUtilsReserveExceedsPool")

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("4390243902439024390243902439024") // 4.39

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        await call(
            vaultRouter
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    toUsd(4),
                    toUsd(90),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq("0") // size
        expect(position.collateral).eq("0") // collateral
        expect(position.average_price).eq("0") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("0") // reserveAmount, 0.00225 * 40,000 => 90
        expect(position.realized_pnl.value).eq("0") // pnl
        expect(position.realized_pnl.is_neg).eq(false)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 230)) // 0.00000230 * 39000 => ~0.09 USD
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 13923 - 230)) // 0.00013923 * 39000 => ~5.42 USD
        expect(await getBalance(user2, BTC)).eq("13922") // 0.00013922 * 39000 => 5.42958 USD

        await validateVaultRouterBalance(expect, vault, vaultStorage, vaultUtils, BTC, 1)
    })
})
