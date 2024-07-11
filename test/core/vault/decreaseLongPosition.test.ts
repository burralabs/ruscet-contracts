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

describe("Vault.decreaseLongPosition", () => {
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

        await vaultStorage.functions
            .set_fees(
                50, // _taxBasisPoints
                20, // _stableTaxBasisPoints
                30, // _mintBurnFeeBasisPoints
                30, // _swapFeeBasisPoints
                4, // _stableSwapFeeBasisPoints
                10, // _marginFeeBasisPoints
                toUsd(5), // _liquidationFeeUsd
                60 * 60, // _minProfitTime
                false, // _hasDynamicFees
            )
            .call()

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

    it("decreasePosition long", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await expect(
            vault
                .connect(user1)
                .functions.decrease_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, 0, true, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInvalidMsgCaller")

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    0,
                    toUsd(1000),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultEmptyPosition")

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9970000000") // 99.7
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10219250000") // 102.1925

        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9970240000") // 99.7024
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10019271000") // 100.19271

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        // test that minProfitBasisPoints works as expected
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)).call()
        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("2195121951219512195121951219") // ~0.00219512195 USD

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)).call() // 41000 * 0.75% => 307.5
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 308)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 308)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 308)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("676097560975609756097560975609") // ~0.676 USD

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(45100)).call()

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("2195121951219512195121951219512") // ~2.1951

        await BTCPricefeed.functions.set_latest_answer(toPrice(46100)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("2195121951219512195121951219512") // ~2.1951

        await BTCPricefeed.functions.set_latest_answer(toPrice(47100)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(9))

        let leverage = await getValStr(
            vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
        )
        expect(leverage).eq("90817") // ~9X leverage

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    0,
                    toUsd(100),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultPositionSizeExceeded")

        // await expect(
        //     vault
        //         .connect(user0)
        //         .functions.decrease_position(
        //             toAddress(user0),
        //             toAsset(BTC),
        //             toAsset(BTC),
        //             toUsd(8.91),
        //             toUsd(50),
        //             true,
        //             addrToAccount(user2),
        //         )
        // .addContracts(attachedContracts)
        //         .call(),
        // ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10220298100") // 102.202981
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10318360100") // 103.183601

        await vault
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
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10391774600") // 103.917746
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10705866600") // 107.058666

        leverage = await getValStr(
            vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
        )
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
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 16878 - 106 - 1))
        expect(await getBalance(user2, BTC)).eq("16878") // 0.00016878 * 47100 => 7.949538 USD

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC, 1)
    })

    it("decreasePosition long aum", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(500)).call()

        await BNB.functions.mint(contrToAccount(vault), expandDecimals(10)).call()
        await vault.functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("498500000000") // 4985
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("498500000000") // 4985

        await BNB.functions.mint(contrToAccount(vault), expandDecimals(1)).call()
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(1000), true)
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("498500000000") // 4985
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("498500000000") // 4985

        await BNBPricefeed.functions.set_latest_answer(toPrice(750)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(750)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(750)).call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("722700000000") // 7227
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("722700000000") // 7227

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BNB),
                toAsset(BNB),
                toUsd(0),
                toUsd(500),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("722700000250") // 7227.00000000000000025
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("722700000250") // 7227.00000000000000025

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BNB),
                toAsset(BNB),
                toUsd(250),
                toUsd(100),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("722700000250") // 7227.00000000000000025
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("722700000250") // 7227.00000000000000025
    })

    it("decreasePosition long minProfitBasisPoints", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await expect(
            vault
                .connect(user1)
                .functions.decrease_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), 0, 0, true, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInvalidMsgCaller")

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    0,
                    toUsd(1000),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultEmptyPosition")

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
            .addContracts(attachedContracts)
            .call()

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        // test that minProfitBasisPoints works as expected
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 - 1)).call()
        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("2195121951219512195121951219") // ~0.00219512195 USD

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)).call() // 41000 * 0.75% => 307.5
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(41000 + 307)).call()
        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("0")

        // await increaseTime(provider, 50 * 60)
        // await mineBlock(provider)

        // delta = formatObj(await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)))
        // expect(delta[0]).eq(true)
        // expect(delta[1]).eq("0")

        // await increaseTime(provider, 10 * 60 + 10)
        // await mineBlock(provider)

        // delta = formatObj(await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)))
        // expect(delta[0]).eq(true)
        // expect(delta[1]).eq("673902439024390243902439024390") // 0.67390243902
    })

    it("decreasePosition long with loss", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
            .addContracts(attachedContracts)
            .call()

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await BTCPricefeed.functions.set_latest_answer(toPrice(40790)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40690)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40590)).call()

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(0.9))

        await expect(
            vault
                .connect(user0)
                .functions.decrease_position(
                    addrToAccount(user0),
                    toAsset(BTC),
                    toAsset(BTC),
                    toUsd(4),
                    toUsd(50),
                    true,
                    addrToAccount(user2),
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BTC),
                toAsset(BTC),
                toUsd(0),
                toUsd(50),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.36)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("100000") // reserveAmount, 0.00100 * 40,000 => 40
        expect(position[5].value).eq(toUsd(0.5)) // pnl
        expect(position[6]).eq(false)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 122)) // 0.00000122 * 40790 => ~0.05 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("100000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(30.64))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 122))
        expect(await getBalance(user2, BTC)).eq("0")

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BTC),
                toAsset(BTC),
                toUsd(0),
                toUsd(40),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount
        expect(position[5].value).eq("0") // pnl
        expect(position[6]).eq(true)

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 122 + 98)) // 0.00000098 * 40790 => ~0.04 USD
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 122 - 98 - 21868))
        expect(await getBalance(user2, BTC)).eq("21868") // 0.00021868 * 40790 => ~8.92 USD

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC)
    })

    it("decreasePosition negative collateral", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
            .addContracts(attachedContracts)
            .call()

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        await BTCPricefeed.functions.set_latest_answer(toPrice(80000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(80000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(80000)).call()

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("975")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq("274025")
        expect(await getBalance(user2, BTC)).eq("0")

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(90))

        expect(await getValStr(vaultUtils.functions.get_cumulative_funding_rates(toAsset(BTC)))).eq("0")

        // await increaseTime(provider, 100 * 24 * 60 * 60)

        // await vault.functions.update_cumulative_funding_rate(toAsset(BTC), toAsset(BTC)).call()
        // expect(await getValStr(vaultUtils.functions.get_cumulative_funding_rates(toAsset(BTC)))).eq("147796")

        // @TODO: this doesn't revert for some reason
        // await expect(
        //     vault
        //         .connect(user0)
        //         .functions.decrease_position(
        //             toAddress(user0),
        //             toAsset(BTC),
        //             toAsset(BTC),
        //             0,
        //             toUsd(10),
        //             true,
        //             addrToAccount(user2),
        //         )
        // .addContracts(attachedContracts)
        //         .call(),
        // ).to.be.revertedWith("ArithmeticOverflow")

        await vault
            .connect(user0)
            .functions.decrease_position(
                addrToAccount(user0),
                toAsset(BTC),
                toAsset(BTC),
                0,
                toUsd(50),
                true,
                addrToAccount(user2),
            )
            .addContracts(attachedContracts)
            .call()

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        // @TODO: uncomment the following when mineBlock is available for Fuel node
        // expect(position[3]).eq(147796") // entryFundingRate
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("100000") // reserveAmount, 0.00100 * 40,000 => 40
        expect(position[5].value).eq(toUsd(50)) // pnl
        expect(position[6]).eq(true)

        await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC, 1)
    })
})
