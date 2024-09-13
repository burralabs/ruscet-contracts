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

describe("Vault.decreaseShortPosition", () => {
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

    it("decreasePosition short", async () => {
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

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await expect(
            vault
                .connect(user1)
                .functions.decrease_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, 0, false, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInvalidMsgCaller")

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BTC),
                    0,
                    toUsd(1000),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultEmptyPosition")

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(100))
        await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 0").eq("9996000000") // 99.96
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 0").eq("9996000000") // 99.96

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(10))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 1").eq("9996000000") // 99.96
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 1").eq("10221000000") // 102.21

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(90)) // reserveAmount
        expect(position[5].value).eq("0") // pnl
        expect(position[6]).eq(true) // hasRealisedProfit

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(44000)))
        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(9))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(1)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(9))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(1)))
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(89.99775))

        let leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)

        expect(leverage).eq("90817") // ~9X leverage

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BTC),
                    0,
                    toUsd(100),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultPositionSizeExceeded")

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BTC),
                    toUsd(5),
                    toUsd(50),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("13000000") // 0.13, 0.4 + 0.9
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(90))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("9996000000") // 99.96
        expect(await getBalance(user2, DAI)).eq("0")

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 2").eq("996225000") // 9.96225
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 2").eq("996225000") // 9.96225

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BTC),
                    toUsd(3),
                    toUsd(50),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 3").eq("996225000") // 9.96225
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 3").eq("996225000") // 9.96225

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.91 - 3)) // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(40)) // reserveAmount
        expect(position[5].value).eq(toUsd(49.99875)) // pnl
        expect(position[6]).eq(true) // hasRealisedProfit

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("18000000") // 0.18, 0.4 + 0.9 + 0.5
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(40))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("4996125000") //49.96125
        expect(await getBalance(user2, DAI)).eq("5294875000") // 52.94875

        // (9.91-3) + 0.44 + 49.70125 + 52.94875 => 110

        leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)

        expect(leverage).eq("57887") // ~5.8X leverage
    })

    it("decreasePosition short minProfitBasisPoints", async () => {
        await call(
            vaultStorage.functions.set_fees(
                50, // _taxBasisPoints
                10, // _stableTaxBasisPoints
                4, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                60 * 60, // _minProfitTime
                false, // _hasDynamicFees
            ),
        )

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await expect(
            vault
                .connect(user1)
                .functions.decrease_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, 0, false, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInvalidMsgCaller")

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BTC),
                    0,
                    toUsd(1000),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultEmptyPosition")

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(100))
        await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 4").eq("9996000000") // 99.96
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 4").eq("9996000000") // 99.96

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(10))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 5").eq("9996000000") // 99.96
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 5").eq("10221000000") // 102.21

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(90)) // reserveAmount
        expect(position[5].value).eq("0") // pnl
        expect(position[6]).eq(true) // hasRealisedProfit

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39701))) // 40,000 * (100 - 0.75)% => 39700
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39701)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39701)))
        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(0))

        // @TODO: uncomment when mineBlock is supported in Fuel
        // await increaseTime(provider, 50 * 60)
        // await mineBlock(provider)

        // delta = formatObj(await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)))
        // expect(delta[0]).eq(true)
        // expect(delta[1]).eq("0")

        // await increaseTime(provider, 10 * 60 + 10)
        // await mineBlock(provider)

        // delta = formatObj(await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)))
        // expect(delta[0]).eq(true)
        // expect(delta[1]).eq("67275000000000000000") // 0.67275
    })

    it("decreasePosition short with loss", async () => {
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

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(100))
        await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 6").eq("9996000000") // 99.96
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 6").eq("9996000000") // 99.96

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(10))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 7").eq("9996000000") // 99.96
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 7").eq("10221000000") // 102.21

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(90)) // reserveAmount
        expect(position[5].value).eq("0") // pnl
        expect(position[6]).eq(true) // hasRealisedProfit

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40400)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40400)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40400)))
        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(0.9))

        let leverage = await getPositionLeverage(vaultStorage, addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)

        expect(leverage).eq("90817") // ~9X leverage

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("13000000") // 0.13
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(90))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("9996000000") // 99.6
        expect(await getBalance(user2, DAI)).eq("0")

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BTC),
                    toUsd(4),
                    toUsd(50),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 7").eq("10086000000") // 100.86
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 7").eq("10086000000") // 100.86

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BTC),
                    toUsd(0),
                    toUsd(50),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false)), "aum min 8").eq("10086000000") // 100.86
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true)), "aum max 8").eq("10086000000") // 100.86

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.36)) // collateral, 9.91 - 0.5 (losses) - 0.05 (fees)
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(40)) // reserveAmount
        expect(position[5].value).eq(toUsd(0.5)) // pnl
        expect(position[6]).eq(false) // hasRealisedProfit

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("18000000") // 0.18
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(40)) // 40
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("10046000000") // 100.46
        expect(await getBalance(user2, DAI)).eq("0")

        await call(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(DAI),
                    toAsset(BTC),
                    toUsd(0),
                    toUsd(40),
                    false,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts),
        )

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount
        expect(position[5].value).eq("0") // pnl
        expect(position[6]).eq(true) // hasRealisedProfit

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("22000000") // 0.22
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq("0") // 40
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("10086000000") // 100.86
        expect(await getBalance(user2, DAI)).eq("892000000")
    })
})
