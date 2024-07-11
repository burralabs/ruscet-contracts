import { expect, use } from "chai"
import { AbstractContract, BN, DateTime, FUEL_NETWORK_URL, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    FungibleAbi,
    RlpAbi,
    RlpManagerAbi,
    PricefeedAbi,
    RouterAbi,
    TimeDistributorAbi,
    RusdAbi,
    UtilsAbi,
    VaultAbi,
    VaultPricefeedAbi,
    VaultStorageAbi,
    VaultUtilsAbi,
    YieldTrackerAbi,
} from "../../../types"
import { deploy, getBalance, getValue, getValStr, formatObj } from "../../utils/utils"
import { addrToAccount, contrToAccount, toAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd, toUsdBN } from "../../utils/units"
import { ZERO_B256 } from "../../utils/constants"
import { getAssetId, toAsset, transfer } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { BigNumber } from "ethers"
import { getBnbConfig, getBtcConfig, getDaiConfig, getEthConfig, validateVaultBalance } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"

use(useChai)

describe("Vault.liquidateShortPosition", function () {
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let utils: UtilsAbi
    let BNB: FungibleAbi
    let BNBPricefeed: PricefeedAbi
    let DAI: FungibleAbi
    let DAIPricefeed: PricefeedAbi
    let BTC: FungibleAbi
    let BTCPricefeed: PricefeedAbi
    let vault: VaultAbi
    let vaultStorage: VaultStorageAbi
    let vaultUtils: VaultUtilsAbi
    let rusd: RusdAbi
    let router: RouterAbi
    let vaultPricefeed: VaultPricefeedAbi
    let timeDistributor: TimeDistributorAbi
    let yieldTracker: YieldTrackerAbi
    let rlp: RlpAbi
    let rlpManager: RlpManagerAbi

    beforeEach(async () => {
        const localProvider = await Provider.create(FUEL_NETWORK_URL)

        const wallets = WALLETS.map((k) => Wallet.fromPrivateKey(k, localProvider))

        ;[deployer, user0, user1, user2, user3] = wallets

        /*
            NativeAsset + Pricefeed
        */
        BNB = (await deploy("Fungible", deployer)) as FungibleAbi
        BNBPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        DAI = (await deploy("Fungible", deployer)) as FungibleAbi
        DAIPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        BTC = (await deploy("Fungible", deployer)) as FungibleAbi
        BTCPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        await BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed").call()
        await DAIPricefeed.functions.initialize(addrToAccount(deployer), "DAI Pricefeed").call()
        await BTCPricefeed.functions.initialize(addrToAccount(deployer), "BTC Pricefeed").call()

        /*
            Vault + Router + RUSD
        */
        utils = await deploy("Utils", deployer)
        vault = await deploy("Vault", deployer)
        vaultStorage = await deploy("VaultStorage", deployer)
        vaultUtils = await deploy("VaultUtils", deployer)
        vaultPricefeed = await deploy("VaultPricefeed", deployer)
        rusd = await deploy("Rusd", deployer)
        router = await deploy("Router", deployer)
        timeDistributor = await deploy("TimeDistributor", deployer)
        yieldTracker = await deploy("YieldTracker", deployer)
        rlp = await deploy("Rlp", deployer)
        rlpManager = await deploy("RlpManager", deployer)

        attachedContracts = [vaultUtils, vaultStorage]

        await rusd.functions.initialize(toContract(vault)).call()
        await router.functions.initialize(toContract(vault), toContract(rusd), addrToAccount(deployer)).call()
        await vaultStorage.functions
            .initialize(
                addrToAccount(deployer),
                toContract(router),
                toAsset(rusd), // RUSD native asset
                toContract(rusd), // RUSD contract
                toContract(vaultPricefeed),
                toUsd(5), // liquidationFeeUsd
                600, // fundingRateFactor
                600, // stableFundingRateFactor
            )
            .call()
        await vaultUtils.functions.initialize(addrToAccount(deployer), toContract(vault), toContract(vaultStorage)).call()
        await vault.functions.initialize(addrToAccount(deployer), toContract(vaultUtils), toContract(vaultStorage)).call()
        await vaultStorage.functions.write_authorize(contrToAccount(vault), true).call()
        await vaultStorage.functions.write_authorize(contrToAccount(vaultUtils), true).call()
        await vaultUtils.functions.write_authorize(contrToAccount(vault), true).call()

        await yieldTracker.functions.initialize(toContract(rusd)).call()
        await yieldTracker.functions.set_time_distributor(toContract(timeDistributor)).call()
        await timeDistributor.functions.initialize().call()
        await timeDistributor.functions.set_distribution([contrToAccount(yieldTracker)], [1000], [toAsset(BNB)]).call()

        await BNB.functions.mint(contrToAccount(timeDistributor), 5000).call()
        await rusd.functions.set_yield_trackers([{ bits: contrToAccount(yieldTracker).value }]).call()

        await vaultPricefeed.functions.initialize(addrToAccount(deployer)).call()
        await vaultPricefeed.functions.set_asset_config(toAsset(BNB), toContract(BNBPricefeed), 8, false).call()
        await vaultPricefeed.functions.set_asset_config(toAsset(DAI), toContract(DAIPricefeed), 8, false).call()
        await vaultPricefeed.functions.set_asset_config(toAsset(BTC), toContract(BTCPricefeed), 8, false).call()

        await rlp.functions.initialize().call()
        await rlpManager.functions
            .initialize(
                toContract(vault),
                toContract(rusd),
                toContract(rlp),
                toContract(ZERO_B256),
                24 * 3600, // 24 hours
            )
            .call()
    })

    it("liquidate short", async () => {
        await vaultStorage.functions
            .set_fees(
                50, // _taxBasisPoints
                10, // _stableTaxBasisPoints
                4, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                0, // _minProfitTime
                false, // _hasDynamicFees
            )
            .call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultEmptyPosition")

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("0")

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)).call()
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(100))
        await vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(10))
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
            .addContracts(attachedContracts)
            .call()

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(90)) // reserveAmount

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(90))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9996000000") // 99.96

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(2.25)) // 1000 / 40,000 * 90
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(2.25))
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await expect(
            vault.functions
                .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await BTCPricefeed.functions.set_latest_answer(toPrice(42500)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("5625000000000000000000000000000") // 2500 / 40,000 * 90 => 5.625
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("1")

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(90)) // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("13000000") // 0.13
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(90))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("9996000000")
        expect(await getBalance(user2, DAI)).eq("0")

        await vault.functions
            .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
            .addContracts(attachedContracts)
            .call()

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("22000000") // 0.22
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("10478000000") // 104.78
        expect(await getBalance(user2, DAI)).eq(expandDecimals(5))

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10478000000") // 104.78

        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(20))
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(100))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(50000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10478000000") // 104.78

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        await validateVaultBalance(
            expect,
            vault,
            vaultStorage,
            vaultUtils,
            DAI,
            BigNumber.from(position[1]).mul(expandDecimals(10)).div(expandDecimals(10, 30)).toString(),
        )
    })

    it("automatic stop-loss", async () => {
        await vaultStorage.functions
            .set_fees(
                50, // _taxBasisPoints
                10, // _stableTaxBasisPoints
                4, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                0, // _minProfitTime
                false, // _hasDynamicFees
            )
            .call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultEmptyPosition")

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("0")

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(1001)).call()
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(1001))
        await vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(100)).call()
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(100))
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
            .addContracts(attachedContracts)
            .call()

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(1000)) // size
        expect(position[1]).eq(toUsd(99)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(1000)) // reserveAmount

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(1000))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("100059960000") // 1000.5996

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(25)) // 1000 / 40,000 * 1000
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(25))
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await expect(
            vault.functions
                .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await BTCPricefeed.functions.set_latest_answer(toPrice(45000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(45000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(45000)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(125)) // 5000 / 40,000 * 1000 => 125
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("1")

        await BTCPricefeed.functions.set_latest_answer(toPrice(43600)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(43600)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(43600)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(90)) // 3600 / 40,000 * 1000 => 90
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("2")

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(1000)) // size
        expect(position[1]).eq(toUsd(99)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(1000)) // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("140040000") // 1.4004
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(1000))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("100059960000") // 1000.5996
        expect(await getBalance(deployer, DAI)).eq("0")
        expect(await getBalance(user0, DAI)).eq("0")
        expect(await getBalance(user1, DAI)).eq("0")
        expect(await getBalance(user2, DAI)).eq("0")
        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(1000))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("109059960000") // 1090.5996

        await vault.functions
            .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
            .addContracts(attachedContracts)
            .call()

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("240040000") // 2.4004
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("109059960000") // 1090.5996
        expect(await getBalance(deployer, DAI)).eq("0")
        expect(await getBalance(user0, DAI)).eq(expandDecimals(8))
        expect(await getBalance(user1, DAI)).eq("0")
        expect(await getBalance(user2, DAI)).eq("0")

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("109059960000") // 1090.5996

        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(20)).call()
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(20))
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(100))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(50000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("109059960000") // 1090.5996

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        await validateVaultBalance(
            expect,
            vault,
            vaultStorage,
            vaultUtils,
            DAI,
            BigNumber.from(position[1]).mul(expandDecimals(10)).div(expandDecimals(10, 30)).toString(),
        )
    })

    it("global AUM", async () => {
        await vaultStorage.functions
            .set_fees(
                50, // _taxBasisPoints
                10, // _stableTaxBasisPoints
                4, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                0, // _minProfitTime
                false, // _hasDynamicFees
            )
            .call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultEmptyPosition")

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("0")

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(1001)).call()
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(1001))
        await vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(100)).call()
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(100))
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
            .addContracts(attachedContracts)
            .call()

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(1000)) // size
        expect(position[1]).eq(toUsd(99)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(1000)) // reserveAmount

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(1000))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("100059960000") // 1000.5996

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(25)) // 1000 / 40,000 * 1000
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(25))
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await expect(
            vault.functions
                .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                .call(),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await BTCPricefeed.functions.set_latest_answer(toPrice(45000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(45000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(45000)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(125)) // 5000 / 40,000 * 1000 => 125
        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("1")

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(1000)) // size
        expect(position[1]).eq(toUsd(99)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(1000)) // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("140040000") // 1.4004
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(1000))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("100059960000") // 1000.5996
        expect(await getBalance(deployer, DAI)).eq("0")
        expect(await getBalance(user0, DAI)).eq("0")
        expect(await getBalance(user1, DAI)).eq("0")
        expect(await getBalance(user2, DAI)).eq("0")
        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(1000))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("112559960000") // 1125.5996

        await vault.functions
            .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
            .addContracts(attachedContracts)
            .call()

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("240040000") // 2.4004
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("109359960000") // 1093.5996
        expect(await getBalance(deployer, DAI)).eq("0")
        expect(await getBalance(user0, DAI)).eq("0")
        expect(await getBalance(user1, DAI)).eq("0")
        expect(await getBalance(user2, DAI)).eq(expandDecimals(5))

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("109359960000") // 1093.5996

        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()

        await DAI.functions.mint(addrToAccount(user0), expandDecimals(20)).call()
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(20))
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(100))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(50000))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("109359960000") // 1093.5996

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        await validateVaultBalance(
            expect,
            vault,
            vaultStorage,
            vaultUtils,
            DAI,
            BigNumber.from(position[1]).mul(expandDecimals(10)).div(expandDecimals(10, 30)).toString(),
        )
    })
})
