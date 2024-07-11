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
import { addrToAccount, contrToAccount, toAddress, toContract } from "../../utils/account"
import { asStr, expandDecimals, toNormalizedPrice, toPrice, toUsd } from "../../utils/units"
import { ZERO_B256 } from "../../utils/constants"
import { toAsset, transfer } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { getBtcConfig, getDaiConfig } from "../../utils/vault"
import { BigNumber } from "ethers"
import { WALLETS } from "../../utils/wallets"

use(useChai)

describe("Vault.liquidateLongPosition", function () {
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

    it("liquidate long", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultEmptyPosition")

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD

        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD

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

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(43500)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(43500)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(43500)).call()

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

        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
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

        await expect(
            vault.functions
                .liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await BTCPricefeed.functions.set_latest_answer(toPrice(38700)).call()
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

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
        expect(await getBalance(user2, BTC)).eq("0")

        expect((await vaultStorage.functions.in_private_liquidation_mode().call()).value).eq(false)
        await vaultStorage.functions.set_in_private_liquidation_mode(true).call()
        expect((await vaultStorage.functions.in_private_liquidation_mode().call()).value).eq(true)

        await expect(
            vault
                .connect(user1)
                .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInvalidLiquidator")

        expect((await vaultStorage.functions.is_liquidator(addrToAccount(user1)).call()).value).eq(false)
        await vaultStorage.functions.set_liquidator(addrToAccount(user1), true).call()
        expect((await vaultStorage.functions.is_liquidator(addrToAccount(user1)).call()).value).eq(true)

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9906499700") // 99.064997
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10141848500") // 101.418485
        await vault
            .connect(user1)
            .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10152209700") // 101.522097
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("11411398500") // 114.113985

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount

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

        await vault.functions.withdraw_fees(toAsset(BTC), addrToAccount(user0)).addContracts(attachedContracts).call()

        await BTC.functions.mint(contrToAccount(vault), 1000).call()
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()
    })

    it("automatic stop-loss", async () => {
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await expect(
            vault
                .connect(user0)
                .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultEmptyPosition")

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 5000000) // 0.05 BTC => 2000 USD
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(1000), true)
            .addContracts(attachedContracts)
            .call()

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(1000)) // size
        expect(position[1]).eq(toUsd(99)) // collateral, 100 - 1000 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("2500000") // reserveAmount, 0.025 * 40,000 => 1000

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(43500)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(43500)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(43500)).call()

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

        await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
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

        await expect(
            vault.functions
                .liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await BTCPricefeed.functions.set_latest_answer(toPrice(37760)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(37760)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(37760)).call()

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

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
        )
        expect(position[0]).eq(toUsd(1000)) // size
        expect(position[1]).eq(toUsd(99)) // collateral, 100 - 1000 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("2500000") // reserveAmount, 0.025 * 40,000 => 1000

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("17439")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("2500000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(901))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(5000000 + 250000 - 17439))
        expect(await getBalance(deployer, BTC)).eq("0")
        expect(await getBalance(user0, BTC)).eq("0")
        expect(await getBalance(user1, BTC)).eq("194750000")
        expect(await getBalance(user2, BTC)).eq("0")

        await vault.functions
            .liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
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

        await vault.functions.withdraw_fees(toAsset(BTC), addrToAccount(user0)).addContracts(attachedContracts).call()

        await BTC.functions.mint(contrToAccount(vault), 1000).call()
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()
    })

    /*
    it("excludes AMM price", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(600)).call()
        await busdPriceFeed.setLatestAnswer(toPrice(1))

        const bnbBusd = await deployContract("PancakePair", [])
        await bnbBusd.setReserves(expandDecimals(1000, 18), expandDecimals(1000 * 1000, 18))

        const ethBnb = await deployContract("PancakePair", [])
        await ethBnb.setReserves(expandDecimals(800, 18), expandDecimals(100, 18))

        const BTCBnb = await deployContract("PancakePair", [])
        await BTCBnb.setReserves(expandDecimals(25, 18), expandDecimals(1000, 18))

        await vaultPriceFeed.setTokens(toAsset(BTC), eth.address, toAsset(BNB))
        await vaultPriceFeed.setPairs(bnbBusd.address, ethBnb.address, BTCBnb.address)

        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

        await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
        await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).call()

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
        await vault
            .connect(user0)
            .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
            .call()

        let position = formatObj(await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)))
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        expect((formatObj(await getValue(vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false))))[0]).eq("0")

        await BTCPricefeed.functions.set_latest_answer(toPrice(43500)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(43500)).call()
        await BTCPricefeed.functions.set_latest_answer(toPrice(43500)).call()

        let delta = formatObj(await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)))
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("2195121951219512195121951219512") // ~2.195
        expect((formatObj(await getValue(vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false))))[0]).eq("0")

        await BTCBnb.setReserves(expandDecimals(26, 18), expandDecimals(1000, 18))
        delta = formatObj(await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)))
        expect(delta[0]).eq(false)
        expect(delta[1]).eq("5572232645403377110694183864916") // ~5.572
        expect((formatObj(await getValue(vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false))))[0]).eq("1")

        position = formatObj(await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)))
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(969)
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(274250 - 219)
        expect(await getBalance(user2, BTC)).eq("0")

        await expect(vault.functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))).to.be.revertedWith(.call()
            "VaultPositionCannotBeLiquidated",
        )

        await BTCPricefeed.functions.set_latest_answer(toPrice(38700)).call()

        await vault.functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2)).call()

        position = formatObj(await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)))
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(1175)
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(262756 - 219 - 206)
        expect(await getBalance(user2, BTC)).eq(11494) // 0.00011494 * 43500 => ~5
    })
    */
})
