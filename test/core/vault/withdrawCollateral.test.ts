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
import { addrToAccount, contrToAccount, toAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd, toUsdBN } from "../../utils/units"
import { ZERO_B256 } from "../../utils/constants"
import { getAssetId, toAsset, transfer } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BigNumber } from "ethers"
import { getBnbConfig, getBtcConfig, getDaiConfig, getEthConfig, validateVaultBalance } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"
import { getPositionLeverage } from "../../utils/contract"

use(useChai)

describe("Vault.withdrawCollateral", function () {
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
                toContract(router),
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
        await call(vaultPricefeed.functions.set_asset_config(toAsset(DAI), toContract(DAIPricefeed), 8, false))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(BTC), toContract(BTCPricefeed), 8, false))

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

    it("withdraw collateral", async () => {
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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(46100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(47100)))

        let leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)
        expect(leverage).eq("90817") // ~9X leverage

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    toUsd(3),
                    toUsd(50),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)
        expect(leverage).eq("57887") // ~5.8X leverage

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.91 - 3)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(asStr((225000 / 90) * 40)) // reserveAmount, 0.00225 * 40,000 => 90
        expect(position[5].value).eq(toUsd(5)) // pnl
        expect(position[6]).eq(true)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 106)) // 0.00000106 * 45100 => ~0.05 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr((225000 / 90) * 40))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(33.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 16878 - 106 - 1 - 219))
        expect(await getBalance(user2, BTC)).eq("16878") // 0.00016878 * 47100 => 7.949538 USD

        await expect(
            call(
                vault
                    .connect(user0)
                    .functions.decrease_position(
                        addrToAccount(user0),
                        toAsset(BTC),
                        toAsset(BTC),
                        toUsd(3),
                        0,
                        true,
                        addrToAccount(user2),
                    )
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    toUsd(1),
                    0,
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.91 - 3 - 1)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(asStr((225000 / 90) * 40)) // reserveAmount, 0.00225 * 40,000 => 90
        expect(position[5].value).eq(toUsd(5)) // pnl
        expect(position[6]).eq(true)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 106)) // 0.00000106 * 45100 => ~0.05 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr((225000 / 90) * 40))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(34.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(
            asStr(274250 - 16878 - 106 - 1 - 2123 - 219),
        ) // 0.00002123 * 47100 => 1 USD
        expect(await getBalance(user2, BTC)).eq(asStr(16878 + 2123))
    })

    it("withdraw during cooldown duration", async () => {
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
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(46100)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(47100)))

        // it's okay to withdraw AND decrease size with at least same proportion (e.g. if leverage is decreased or the same)
        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    toUsd(1),
                    toUsd(10),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        // it's also okay to fully close position
        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    position[1],
                    position[0],
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(30), true)
                .addContracts(attachedContracts),
        )
    })

    it("withdraw collateral long", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))

        await call(BNB.functions.mint(contrToAccount(vault), expandDecimals(10, 8)))
        await call(vault.functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("498500000000") // 4985
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("498500000000") // 4985

        await call(BNB.functions.mint(contrToAccount(vault), expandDecimals(1, 8)))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(2000), true)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("498500000000") // 4985
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("498500000000") // 4985

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(750)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(750)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(750)))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("672650000000") // 6726.5
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("672650000000") // 6726.5

        await call(BNB.functions.mint(contrToAccount(vault), expandDecimals(1, 8)))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(0), true)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("672650000000") // 6726.5
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("672650000000") // 6726.5

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BNB),
                    toAsset(BNB),
                    toUsd(500),
                    toUsd(0),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("672650000500") // 6726.5000000000000005
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("672650000500") // 6726.5000000000000005

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(400)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(400)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(400)))

        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("417173333600") // 4171.7333333333333336
        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("417173333600") // 4171.7333333333333336

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BNB),
                    toAsset(BNB),
                    toUsd(250),
                    toUsd(0),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("417173333600") // 4171.7333333333333336
        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("417173333600") // 4171.7333333333333336

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BNB),
                    toAsset(BNB),
                    toUsd(0),
                    toUsd(250),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("417173333600") // 4171.7333333333333336
        // @TODO: actually: 417173333333
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("417173333600") // 4171.7333333333333336
    })

    it("withdraw collateral short", async () => {
        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(500)))

        await call(DAI.functions.mint(contrToAccount(vault), expandDecimals(8000, 8)))
        await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("797600000000") // 7976
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("797600000000") // 7976

        await call(DAI.functions.mint(contrToAccount(vault), expandDecimals(500, 8)))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BNB), toUsd(2000), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("797600000000") // 7976
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("797600000000") // 7976

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(525)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(525)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(525)))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("807600000000") // 8076
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("807600000000") // 8076

        await call(DAI.functions.mint(contrToAccount(vault), expandDecimals(500, 8)))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BNB), toUsd(0), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("807600000000") // 8076
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("807600000000") // 8076

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BNB),
                    toUsd(500),
                    toUsd(0),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("807600000000") // 8076
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("807600000000") // 8076

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(475)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(475)))
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(475)))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("787600000000") // 7876
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("787600000000") // 7876

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BNB),
                    toUsd(0),
                    toUsd(500),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("787600000000") // 7876
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("787600000000") // 7876
    })
})
