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
import { getAssetId, toAsset, transfer } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BigNumber } from "ethers"
import { BTC_MAX_LEVERAGE, DAI_MAX_LEVERAGE, getBtcConfig, getDaiConfig } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPosition } from "../../utils/contract"
import { DECIMALS } from "../../utils/constants"

use(useChai)

describe("VaultRouter.liquidateLongPosition", () => {
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
                toContract(rusd), // RUSD contract
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

    it("liquidate long", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(vaultStorage.functions.set_liquidator(addrToAccount(user0), true))
        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterEmptyPosition")

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))
        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))

        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    // 0.0025 BTC => 100 USD
                    forward: [250000, getAssetId(BTC)],
                }),
        )

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1)))

        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .callParams({
                    // 0.00025 BTC => 10 USD
                    forward: [25000, getAssetId(BTC)],
                }),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("5487804878048780487804878048780") // ~5.48
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("4390243902439024390243902439024") // ~4.39
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("0")

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await expect(
            call(
                vaultRouter.functions
                    .liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(38700)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("5048780487804878048780487804878") // ~5.04
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("1")

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(90)) // size
        expect(position.collateral).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        await expect(
            call(
                vaultRouter
                    .connect(user1)
                    .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterInvalidLiquidator")

        expect(await getValue(vaultStorage.functions.is_liquidator(addrToAccount(user1)))).eq(false)
        await call(vaultStorage.functions.set_liquidator(addrToAccount(user1), true))
        expect(await getValue(vaultStorage.functions.is_liquidator(addrToAccount(user1)))).eq(true)

        await call(
            vaultRouter
                .connect(user1)
                .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq("0") // size
        expect(position.collateral).eq("0") // collateral
        expect(position.average_price).eq("0") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("0") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("1175")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(262756 - 219 - 206))
        expect(await getBalance(user2, BTC)).eq("11494") // 0.00011494 * 43500 => ~5

        expect(await getBalance(user2, BTC))

        expect(await getBalance(vault, BTC, utils)).eq("263506")

        const balance = BigNumber.from(await getBalance(vault, BTC, utils))
        const poolAmount = BigNumber.from(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC))))
        const feeReserve = BigNumber.from(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC))))
        expect(poolAmount.add(feeReserve).sub(balance).toString()).eq("0")

        await call(vaultRouter.functions.withdraw_fees(toAsset(BTC), addrToAccount(user0)).addContracts(attachedContracts))

        // await call(BTC.functions.mint(contrToAccount(vaultRouter), 1000))
        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [1000, getAssetId(BTC)],
                }),
        )
    })

    it("automatic stop-loss", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))
        await call(vaultUtils.functions.set_max_leverage(toAsset(BTC), BTC_MAX_LEVERAGE))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(vaultStorage.functions.set_liquidator(addrToAccount(user0), true))
        await expect(
            call(
                vaultRouter
                    .connect(user0)
                    .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultRouterEmptyPosition")

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))
        await call(
            vaultRouter
                .as(user1)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    // 0.05 BTC => 2000 USD
                    forward: [5000000, getAssetId(BTC)],
                }),
        )

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1)))
        await transfer(BTC.as(user1), addrToAccount(user0), 250000) // 0.0025 BTC => 100 USD
        await call(
            vaultRouter
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(1000), true)
                .callParams({
                    // 0.0025 BTC => 100 USD
                    forward: [250000, getAssetId(BTC)],
                })
                .addContracts(attachedContracts),
        )

        let position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(1000)) // size
        expect(position.collateral).eq(toUsd(99)) // collateral, 100 - 1000 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("2500000") // reserveAmount, 0.025 * 40,000 => 1000

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("60975609756097560975609756097560") // ~60.9756097561
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("48780487804878048780487804878048") // ~48.7804878049
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("0")

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await expect(
            call(
                vaultRouter.functions
                    .liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(37760)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(37760)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(37760)))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("79024390243902439024390243902439") // ~79.0243902439
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("2")

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq(toUsd(1000)) // size
        expect(position.collateral).eq(toUsd(99)) // collateral, 100 - 1000 * 0.1%
        expect(position.average_price).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("2500000") // reserveAmount, 0.025 * 40,000 => 1000

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("17439")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("2500000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(901))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(5000000 + 250000 - 17439))
        expect(await getBalance(deployer, BTC)).eq("0")
        expect(await getBalance(user0, BTC)).eq("0")
        expect(await getBalance(user1, BTC)).eq("194750000")
        expect(await getBalance(user2, BTC)).eq("0")

        await call(
            vaultRouter.functions
                .liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                .addContracts(attachedContracts),
        )

        position = formatObj(await getPosition(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, vaultStorage))
        expect(position.size).eq("0") // size
        expect(position.collateral).eq("0") // collateral
        expect(position.average_price).eq("0") // averagePrice
        expect(position.entry_funding_rate).eq("0") // entryFundingRate
        expect(position.reserve_amount).eq("0") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(17439 + 2648))
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr(5000000 + 250000 - 17439 - 2648 - 50253),
        )
        expect(await getBalance(deployer, BTC)).eq("0")
        expect(await getBalance(user0, BTC)).eq("50253") // 50253 / (10**8) * 37760 => 18.9755328
        expect(await getBalance(user1, BTC)).eq("194750000")
        expect(await getBalance(user2, BTC)).eq("0")

        expect(await getBalance(vault, BTC, utils)).eq(asStr(5000000 + 250000 - 50253))

        const balance = BigNumber.from(await getBalance(vault, BTC, utils))
        const poolAmount = BigNumber.from(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC))))
        const feeReserve = BigNumber.from(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC))))
        expect(poolAmount.add(feeReserve).sub(balance).toString()).eq("0")

        await call(vaultRouter.functions.withdraw_fees(toAsset(BTC), addrToAccount(user0)).addContracts(attachedContracts))

        // await call(BTC.functions.mint(contrToAccount(vaultRouter), 1000))
        await call(
            vaultRouter
                .as(user0)
                .functions.buy_rusd(toAsset(BTC), addrToAccount(user1))
                .addContracts(attachedContracts)
                .callParams({
                    forward: [1000, getAssetId(BTC)],
                }),
        )
    })
})
