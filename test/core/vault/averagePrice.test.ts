import { expect, use } from "chai"
import { AbstractContract, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    Fungible,
    Rlp,
    RlpManager,
    Pricefeed,
    Router,
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
import { addrToAccount, contrToAccount, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd } from "../../utils/units"
import { ZERO_B256 } from "../../utils/constants"
import { toAsset, transfer } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { getBtcConfig, getDaiConfig, getEthConfig, validateVaultBalance } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPositionLeverage } from "../../utils/contract"

use(useChai)

describe("Vault.averagePrice", () => {
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let utils: Utils
    let BNB: Fungible
    let BNBPricefeed: Pricefeed
    let ETH: Fungible
    let ETHPricefeed: Pricefeed
    let DAI: Fungible
    let DAIPricefeed: Pricefeed
    let BTC: Fungible
    let BTCPricefeed: Pricefeed
    let vault: Vault
    let vaultStorage: VaultStorage
    let vaultUtils: VaultUtils
    let rusd: Rusd
    let router: Router
    let vaultPricefeed: VaultPricefeed
    let timeDistributor: TimeDistributor
    let yieldTracker: YieldTracker
    let rlp: Rlp
    let rlpManager: RlpManager

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

        ETH = await deploy("Fungible", deployer)
        ETHPricefeed = await deploy("Pricefeed", deployer)

        DAI = await deploy("Fungible", deployer)
        DAIPricefeed = await deploy("Pricefeed", deployer)

        BTC = await deploy("Fungible", deployer)
        BTCPricefeed = await deploy("Pricefeed", deployer)

        await call(BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed"))
        await call(ETHPricefeed.functions.initialize(addrToAccount(deployer), "ETH Pricefeed"))
        await call(DAIPricefeed.functions.initialize(addrToAccount(deployer), "DAI Pricefeed"))
        await call(BTCPricefeed.functions.initialize(addrToAccount(deployer), "BTC Pricefeed"))

        /*
            Vault + Router + RUSD
        */
        utils = await deploy("Utils", deployer)
        vaultStorage = await deploy("VaultStorage", deployer)
        vaultUtils = await deploy("VaultUtils", deployer)
        vault = await deploy("Vault", deployer, { VAULT_STORAGE: toContract(vaultStorage), VAULT_UTILS: toContract(vaultUtils) })
        vaultPricefeed = await deploy("VaultPricefeed", deployer)
        rusd = await deploy("Rusd", deployer)
        router = await deploy("Router", deployer)
        timeDistributor = await deploy("TimeDistributor", deployer)
        yieldTracker = await deploy("YieldTracker", deployer)
        rlp = await deploy("Rlp", deployer)
        rlpManager = await deploy("RlpManager", deployer)

        attachedContracts = [vaultUtils, vaultStorage]

        await call(rusd.functions.initialize(toContract(vault)))
        await call(router.functions.initialize(toContract(vault), toContract(rusd), addrToAccount(deployer)))
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
        await call(vault.functions.initialize(addrToAccount(deployer)))
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
        await call(vaultPricefeed.functions.set_asset_config(toAsset(ETH), toContract(ETHPricefeed), 8, false))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(DAI), toContract(DAIPricefeed), 8, false))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(BTC), toContract(BTCPricefeed), 8, false))

        await call(
            vaultStorage.functions.set_fees(
                50, // _taxBasisPoints
                20, // _stableTaxBasisPoints
                30, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                60 * 60, // _minProfitTime
                false, // _hasDynamicFees
            ),
        )

        await call(rlp.functions.initialize())
        await call(
            rlpManager.functions.initialize(
                toContract(vault),
                toContract(rusd),
                toContract(rlp),
                toContract(ZERO_B256),
                24 * 3600, // 24 hours
            ),
        )
    })

    describe("Tests", () => {
        it("position.averagePrice, buyPrice < averagePrice", async () => {
            await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
            await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)))
            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await call(vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))

            await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)))
            await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
            await expect(
                call(
                    vault
                        .connect(user0)
                        .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                        .addContracts(attachedContracts),
                ),
            ).to.be.revertedWith("VaultReserveExceedsPool")

            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                    .addContracts(attachedContracts),
            )

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(36900)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(36900)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(36900)))

            let leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)
            expect(leverage).eq("90817") // ~9X leverage
            expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
            expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
            expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
            expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
            expect(await getBalance(user2, BTC)).eq("0")

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq(toUsd(9))

            await expect(
                call(
                    vault
                        .connect(user0)
                        .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                        .addContracts(attachedContracts),
                ),
            ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                    .addContracts(attachedContracts),
            )

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[1]).eq(toUsd(9.91 + 9.215)) // collateral, 0.00025 * 36900 => 9.225, 0.01 fees
            expect(position[2]).eq("40549450549450549450549450549450549") // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(asStr(225000 + 27100)) // reserveAmount, 0.000271 * 36900 => ~10

            leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)
            expect(leverage).eq("52287") // ~5.2X leverage

            expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 27)) // 0.00000027 * 36900 => 0.01 USD
            expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr(225000 + 27100))
            expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.875))
            expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 + 25000 - 219 - 27))
            expect(await getBalance(user2, BTC)).eq("0")

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("8999999999999999999999999999999")

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("1111111111111111111111111111111") // ~1.111

            await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC)
        })

        it("long position.averagePrice, buyPrice == averagePrice", async () => {
            await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
            await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)))
            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await call(vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))

            await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)))
            await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                    .addContracts(attachedContracts),
            )

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("0")

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                    .addContracts(attachedContracts),
            )

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[1]).eq(toUsd(9.91 + 9.99)) // collateral
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(asStr(225000 + 25000)) // reserveAmount

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("0")

            await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC)
        })

        it("long position.averagePrice, buyPrice > averagePrice", async () => {
            await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
            await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)))
            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await call(vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))

            await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)))
            await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                    .addContracts(attachedContracts),
            )

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq(toUsd(22.5))

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)

            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                    .addContracts(attachedContracts),
            )

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[2]).eq("40816326530612244897959183673469387") // averagePrice

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq(toUsd(22.5))

            await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC)
        })

        it("long position.averagePrice, buyPrice < averagePrice", async () => {
            await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
            await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)))

            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await call(vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))

            await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)))
            await transfer(BTC.as(user1), contrToAccount(vault), 125000) // 0.000125 BTC => 50 USD
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                    .addContracts(attachedContracts),
            )

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq(toUsd(22.5))

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                    .addContracts(attachedContracts),
            )

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[2]).eq("38709677419354838709677419354838709") // averagePrice

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("22499999999999999999999999999999")
        })

        it("long position.averagePrice, buyPrice < averagePrice + minProfitBasisPoints", async () => {
            await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
            await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)))
            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await call(vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))

            await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)))
            await transfer(BTC.as(user1), contrToAccount(vault), 125000) // 0.000125 BTC => 50 USD
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                    .addContracts(attachedContracts),
            )

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40300)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40300)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40300)))

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("0")

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                    .addContracts(attachedContracts),
            )

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[2]).eq(toUsd(40300)) // averagePrice

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("0")

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("1736972704714640198511166253101") // (700 / 40300) * 100 => 1.73697
        })

        it("short position.averagePrice, buyPrice == averagePrice", async () => {
            await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
            await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            await call(DAI.functions.mint(addrToAccount(user1), expandDecimals(101, 8)))
            await transfer(DAI.as(user1), contrToAccount(vault), expandDecimals(101, 8))
            await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

            await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(50, 8)))
            await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(50, 8))
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                    .addContracts(attachedContracts),
            )

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(expandDecimals(90, 8))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("0")

            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                    .addContracts(attachedContracts),
            )

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[1]).eq("49900000000000000000000000000000") // collateral
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(expandDecimals(100, 8)) // reserveAmount

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("0")
        })

        it("short position.averagePrice, buyPrice > averagePrice", async () => {
            await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
            await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            await call(DAI.functions.mint(addrToAccount(user1), expandDecimals(101, 8)))
            await transfer(DAI.as(user1), contrToAccount(vault), expandDecimals(101, 8))
            await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

            await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(50, 8)))
            await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(50, 8))
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                    .addContracts(attachedContracts),
            )

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10069700000") // 100.697
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10069700000") // 100.697

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(expandDecimals(90, 8))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("12319700000") // 123.197
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("12319700000") // 123.197

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("22500000000000000000000000000000") // 22.5

            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                    .addContracts(attachedContracts),
            )

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("12319700000") // 123.197
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("12319700000") // 123.197

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[1]).eq("49900000000000000000000000000000") // collateral
            expect(position[2]).eq("40816326530612244897959183673469387") // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(expandDecimals(100, 8)) // reserveAmount

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("22500000000000000000000000000000") // 22.5
        })

        it("short position.averagePrice, buyPrice < averagePrice", async () => {
            await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
            await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            await call(DAI.functions.mint(addrToAccount(user1), expandDecimals(101, 8)))
            await transfer(DAI.as(user1), contrToAccount(vault), expandDecimals(101, 8))
            await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

            await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(50, 8)))
            await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(50, 8))
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                    .addContracts(attachedContracts),
            )

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10069700000") // 100.697
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10069700000") // 100.697

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(expandDecimals(90, 8))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(30000)))

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("7819700000") // 78.197
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("7819700000") // 78.197

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("22500000000000000000000000000000") // 22.5

            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                    .addContracts(attachedContracts),
            )

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("7819700000") // 78.197
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("7819700000") // 78.197

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[1]).eq("49900000000000000000000000000000") // collateral
            expect(position[2]).eq("38709677419354838709677419354838709") // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(expandDecimals(100, 8)) // reserveAmount

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("22499999999999999999999999999999") // ~22.5
        })

        it("short position.averagePrice, buyPrice < averagePrice - minProfitBasisPoints", async () => {
            await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
            await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

            await call(DAI.functions.mint(addrToAccount(user1), expandDecimals(101, 8)))
            await transfer(DAI.as(user1), contrToAccount(vault), expandDecimals(101, 8))
            await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

            await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(50, 8)))
            await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(50, 8))
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                    .addContracts(attachedContracts),
            )

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10069700000") // 100.697
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10069700000") // 100.697

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(expandDecimals(90, 8))

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(39700)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(39700)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(39700)))

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10002200000") // 100.022
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10002200000") // 100.022

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("0") // 22.5

            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                    .addContracts(attachedContracts),
            )

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10002200000") // 100.022
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10002200000") // 100.022

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[1]).eq("49900000000000000000000000000000") // collateral
            expect(position[2]).eq(toUsd(39700)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(expandDecimals(100, 8)) // reserveAmount

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("0") // ~22.5

            await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
            await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9827067758") // 98.27067758
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("9827067758") // 98.27067758

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("1763224181360201511335012594458") // (39700 - 39000) / 39700 * 100 => 1.7632
        })

        it("long position.averagePrice, buyPrice < averagePrice 2", async () => {
            await call(ETHPricefeed.functions.set_latest_answer("251382560787"))
            await call(vaultStorage.functions.set_asset_config(...getEthConfig(ETH)))

            await call(ETHPricefeed.functions.set_latest_answer("252145037536"))
            await call(ETHPricefeed.functions.set_latest_answer("252145037536"))

            await call(ETH.functions.mint(addrToAccount(user1), expandDecimals(10, 8)))
            await transfer(ETH.as(user1), contrToAccount(vault), expandDecimals(10, 8))
            await call(vault.functions.buy_rusd(toAsset(ETH), addrToAccount(user1)).addContracts(attachedContracts))

            await call(ETH.functions.mint(addrToAccount(user0), expandDecimals(1, 8)))
            await transfer(ETH.as(user0), contrToAccount(vault), expandDecimals(1, 8))
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(
                        addrToAccount(user0),
                        toAsset(ETH),
                        toAsset(ETH),
                        "5050322181222357947081599665915068",
                        true,
                    )
                    .addContracts(attachedContracts),
            )

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(ETH), toAsset(ETH), true)),
            )
            expect(position[0]).eq("5050322181222357947081599665915068") // size
            expect(position[1]).eq("2508775285688777642052918400334084") // averagePrice
            expect(position[2]).eq("2521450375360000000000000000000000") // averagePrice
            expect(position[3]).eq("0") // entryFundingRate

            await call(ETHPricefeed.functions.set_latest_answer("237323502539"))
            await call(ETHPricefeed.functions.set_latest_answer("237323502539"))
            await call(ETHPricefeed.functions.set_latest_answer("237323502539"))

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(ETH), toAsset(ETH), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("296866944860754376482796517102673")

            await call(ETH.functions.mint(addrToAccount(user0), expandDecimals(1, 8)))
            await transfer(ETH.as(user0), contrToAccount(vault), expandDecimals(1, 8))
            await call(
                vault
                    .connect(user0)
                    .functions.increase_position(
                        addrToAccount(user0),
                        toAsset(ETH),
                        toAsset(ETH),
                        "4746470050780000000000000000000000",
                        true,
                    )
                    .addContracts(attachedContracts),
            )

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(ETH), toAsset(ETH), true)),
            )
            expect(position[0]).eq("9796792232002357947081599665915068") // size
            expect(position[2]).eq("2447397190894361457116367555285124") // averagePrice
        })
    })
})
