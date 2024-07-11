import { expect, use } from "chai"
import { AbstractContract, FUEL_NETWORK_URL, Provider, Wallet, WalletUnlocked } from "fuels"
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
import { BigNumber } from "ethers"
import { getBtcConfig, getDaiConfig, getEthConfig, validateVaultBalance } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"

use(useChai)

describe("Vault.averagePrice", () => {
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let utils: UtilsAbi
    let BNB: FungibleAbi
    let BNBPricefeed: PricefeedAbi
    let ETH: FungibleAbi
    let ETHPricefeed: PricefeedAbi
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

        ETH = (await deploy("Fungible", deployer)) as FungibleAbi
        ETHPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        DAI = (await deploy("Fungible", deployer)) as FungibleAbi
        DAIPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        BTC = (await deploy("Fungible", deployer)) as FungibleAbi
        BTCPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        await BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed").call()
        await ETHPricefeed.functions.initialize(addrToAccount(deployer), "ETH Pricefeed").call()
        await DAIPricefeed.functions.initialize(addrToAccount(deployer), "DAI Pricefeed").call()
        await BTCPricefeed.functions.initialize(addrToAccount(deployer), "BTC Pricefeed").call()

        /*
            Vault + Router + RUSD
        */
        utils = await deploy("Utils", deployer)
        // toPrice(51108)
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
        await vaultPricefeed.functions.set_asset_config(toAsset(ETH), toContract(ETHPricefeed), 8, false).call()
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

    describe("Tests", () => {
        it("position.averagePrice, buyPrice != markPrice", async () => {
            // DAI
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()
            // BTC
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTC.functions.mint(addrToAccount(user1), expandDecimals(1)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await vault.as(user1).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()
            await BTC.functions.mint(addrToAccount(user0), expandDecimals(1)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
            await expect(
                vault
                    .as(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(110), true)
                    .addContracts(attachedContracts)
                    .call(),
            ).to.be.revertedWith("VaultReserveExceedsPool")

            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .call()

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).to.equal("9970240000") // 99.7024
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).to.equal("10019271000") // 100.19271
            let timestamp = await getValStr(utils.functions.get_timestamp())
            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90
            let lastIncreasedTime = BigNumber.from(position[7])
            // timestamp is within a deviation of 2 (actually: 1), so account for that here
            expect(
                lastIncreasedTime.gte(BigNumber.from(timestamp).sub(2)) &&
                    lastIncreasedTime.lte(BigNumber.from(timestamp).add(2)),
            ).to.be.true // lastIncreasedTime
            await BTCPricefeed.functions.set_latest_answer(toPrice(45100)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(46100)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(47100)).call()
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).to.equal("10220298100") // 102.202981
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).to.equal("10318360100") // 103.183601
            let leverage = await getValStr(
                vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
            )
            expect(leverage).eq("90817") // ~9X leverage
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
            await expect(
                vault
                    .as(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                    .addContracts(attachedContracts)
                    .call(),
            ).to.be.revertedWith("VaultReserveExceedsPool")
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .call()
            timestamp = await getValStr(utils.functions.get_timestamp())
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).to.equal("10220393800") // 102.203938
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).to.equal("10274069800") // 102.740698
            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[1]).eq(toUsd(9.9)) // collateral, 10 - 90 * 0.1%
            expect(position[2]).eq("43211009174311926605504587155963302") // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(asStr(225000 + 22172)) // reserveAmount, 0.00225 * 40,000 => 90, 0.00022172 * 45100 => ~10
            lastIncreasedTime = BigNumber.from(position[7])
            // timestamp is within a deviation of 2 (actually: 1), so account for that here
            expect(
                lastIncreasedTime.gte(BigNumber.from(timestamp).sub(2)) &&
                    lastIncreasedTime.lte(BigNumber.from(timestamp).add(2)),
            ).to.be.true // lastIncreasedTime
            leverage = await getValStr(
                vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
            )
            expect(leverage).eq("101010") // ~10X leverage
            expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 21)) // 0.00000021 * 45100 => 0.01 USD
            expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr(225000 + 22172))
            expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(90.1))
            expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 21))
            expect(await getBalance(user2, BTC)).eq("0")
            // profits will decrease slightly as there is a difference between the buy price and the mark price
            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("4371549893842887473460721868365") // ~4.37
            await BTCPricefeed.functions.set_latest_answer(toPrice(47100)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(47100)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(47100)).call()
            // profits will decrease slightly as there is a difference between the buy price and the mark price
            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq(toUsd(9))
            await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC, 0)
        })

        it("position.averagePrice, buyPrice == markPrice", async () => {
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

            await BTCPricefeed.functions.set_latest_answer(toPrice(45100)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(45100)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(45100)).call()

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10220298100") // 102.202981
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10220298100") // 102.202981

            let leverage = await getValStr(
                vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
            )
            expect(leverage).eq("90817") // ~9X leverage

            expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("969")
            expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("225000")
            expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(80.09))
            expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219))
            expect(await getBalance(user2, BTC)).eq("0")

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq(toUsd(9))

            await expect(
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                    .addContracts(attachedContracts)
                    .call(),
            ).to.be.revertedWith("VaultReserveExceedsPool")

            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .call()

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10220348700") // 102.203487
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10220348700") // 102.203487

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[1]).eq(toUsd(9.9)) // collateral, 10 - 90 * 0.1% - 10 * 0.1%
            expect(position[2]).eq("41376146788990825688073394495412844") // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(asStr(225000 + 22172)) // reserveAmount, 0.00225 * 40,000 => 90, 0.00022172 * 45100 => ~10

            leverage = await getValStr(
                vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
            )
            expect(leverage).eq("101010") // ~10X leverage

            expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq(asStr(969 + 22)) // 0.00000021 * 45100 => 0.01 USD.call()
            expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq(asStr(225000 + 22172))
            expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq(toUsd(90.1))
            expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BTC)))).eq(asStr(274250 - 219 - 22))
            expect(await getBalance(user2, BTC)).eq("0")

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq(toUsd(9))

            await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("909090909090909090909090909090") // ~0.909

            await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("20842572062084257206208425720620") // ~20.84

            await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC)
        })

        it("position.averagePrice, buyPrice < averagePrice", async () => {
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

            await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
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

            await BTCPricefeed.functions.set_latest_answer(toPrice(36900)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(36900)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(36900)).call()

            let leverage = await getValStr(
                vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
            )
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
                vault
                    .connect(user0)
                    .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                    .addContracts(attachedContracts)
                    .call(),
            ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .call()

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(100)) // size
            expect(position[1]).eq(toUsd(9.91 + 9.215)) // collateral, 0.00025 * 36900 => 9.225, 0.01 fees
            expect(position[2]).eq("40549450549450549450549450549450549") // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(asStr(225000 + 27100)) // reserveAmount, 0.000271 * 36900 => ~10

            leverage = await getValStr(
                vaultUtils.functions.get_position_leverage(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true),
            )
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

            await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("1111111111111111111111111111111") // ~1.111

            await validateVaultBalance(expect, vault, vaultStorage, vaultUtils, BTC)
        })

        it("long position.averagePrice, buyPrice == averagePrice", async () => {
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

            await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
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

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("0")

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .call()

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
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

            await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD
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

            await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq(toUsd(22.5))

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)

            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .call()

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
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()

            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

            await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 125000) // 0.000125 BTC => 50 USD
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .call()

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

            await BTCPricefeed.functions.set_latest_answer(toPrice(30000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(30000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(30000)).call()

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq(toUsd(22.5))

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .call()

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
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            await BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
            await vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()

            await BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
            await transfer(BTC.as(user1), contrToAccount(vault), 125000) // 0.000125 BTC => 50 USD
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(90), true)
                .addContracts(attachedContracts)
                .call()

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq("225000") // reserveAmount, 0.00225 * 40,000 => 90

            await BTCPricefeed.functions.set_latest_answer(toPrice(40300)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40300)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40300)).call()

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("0")

            await transfer(BTC.as(user1), contrToAccount(vault), 25000)
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(10), true)
                .addContracts(attachedContracts)
                .call()

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

            await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(41000)).call()

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("1736972704714640198511166253101") // (700 / 40300) * 100 => 1.73697
        })

        it("short position.averagePrice, buyPrice == averagePrice", async () => {
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            await DAI.functions.mint(addrToAccount(user1), expandDecimals(101, 8)).call()
            await transfer(DAI.as(user1), contrToAccount(vault), expandDecimals(101, 8))
            await vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()

            await DAI.functions.mint(addrToAccount(user0), expandDecimals(50, 8)).call()
            await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(50, 8))
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts)
                .call()

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(position[0]).eq(toUsd(90)) // size
            expect(position[1]).eq("49910000000000000000000000000000") // collateral, 50 - 90 * 0.1%
            expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
            expect(position[3]).eq("0") // entryFundingRate
            expect(position[4]).eq(expandDecimals(90, 8))

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("0")

            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                .addContracts(attachedContracts)
                .call()

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
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            await DAI.functions.mint(addrToAccount(user1), expandDecimals(101, 8)).call()
            await transfer(DAI.as(user1), contrToAccount(vault), expandDecimals(101, 8))
            await vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()

            await DAI.functions.mint(addrToAccount(user0), expandDecimals(50, 8)).call()
            await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(50, 8))
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts)
                .call()

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

            await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(50000)).call()

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("12319700000") // 123.197
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("12319700000") // 123.197

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("22500000000000000000000000000000") // 22.5

            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                .addContracts(attachedContracts)
                .call()

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
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            await DAI.functions.mint(addrToAccount(user1), expandDecimals(101, 8)).call()
            await transfer(DAI.as(user1), contrToAccount(vault), expandDecimals(101, 8))
            await vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()

            await DAI.functions.mint(addrToAccount(user0), expandDecimals(50, 8)).call()
            await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(50, 8))
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts)
                .call()

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

            await BTCPricefeed.functions.set_latest_answer(toPrice(30000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(30000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(30000)).call()

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("7819700000") // 78.197
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("7819700000") // 78.197

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("22500000000000000000000000000000") // 22.5

            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                .addContracts(attachedContracts)
                .call()

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
            await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
            await vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(40000)).call()

            await DAI.functions.mint(addrToAccount(user1), expandDecimals(101, 8)).call()
            await transfer(DAI.as(user1), contrToAccount(vault), expandDecimals(101, 8))
            await vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts).call()

            await DAI.functions.mint(addrToAccount(user0), expandDecimals(50, 8)).call()
            await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(50, 8))
            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts)
                .call()

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

            await BTCPricefeed.functions.set_latest_answer(toPrice(39700)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(39700)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(39700)).call()

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("10002200000") // 100.022
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("10002200000") // 100.022

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("0") // 22.5

            await vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(10), false)
                .addContracts(attachedContracts)
                .call()

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

            await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()
            await BTCPricefeed.functions.set_latest_answer(toPrice(39000)).call()

            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("9827067758") // 98.27067758
            expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("9827067758") // 98.27067758

            delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
            )
            expect(delta[0]).eq(true)
            expect(delta[1]).eq("1763224181360201511335012594458") // (39700 - 39000) / 39700 * 100 => 1.7632
        })

        it("long position.averagePrice, buyPrice < averagePrice 2", async () => {
            await ETHPricefeed.functions.set_latest_answer("251382560787").call()
            await vaultStorage.functions.set_asset_config(...getEthConfig(ETH)).call()

            await ETHPricefeed.functions.set_latest_answer("252145037536").call()
            await ETHPricefeed.functions.set_latest_answer("252145037536").call()

            await ETH.functions.mint(addrToAccount(user1), expandDecimals(10, 8)).call()
            await transfer(ETH.as(user1), contrToAccount(vault), expandDecimals(10, 8))
            await vault.functions.buy_rusd(toAsset(ETH), addrToAccount(user1)).addContracts(attachedContracts).call()

            await ETH.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
            await transfer(ETH.as(user0), contrToAccount(vault), expandDecimals(1, 8))
            await vault
                .connect(user0)
                .functions.increase_position(
                    addrToAccount(user0),
                    toAsset(ETH),
                    toAsset(ETH),
                    "5050322181222357947081599665915068",
                    true,
                )
                .addContracts(attachedContracts)
                .call()

            let position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(ETH), toAsset(ETH), true)),
            )
            expect(position[0]).eq("5050322181222357947081599665915068") // size
            expect(position[1]).eq("2508775285688777642052918400334084") // averagePrice
            expect(position[2]).eq("2521450375360000000000000000000000") // averagePrice
            expect(position[3]).eq("0") // entryFundingRate

            await ETHPricefeed.functions.set_latest_answer("237323502539").call()
            await ETHPricefeed.functions.set_latest_answer("237323502539").call()
            await ETHPricefeed.functions.set_latest_answer("237323502539").call()

            let delta = formatObj(
                await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(ETH), toAsset(ETH), true)),
            )
            expect(delta[0]).eq(false)
            expect(delta[1]).eq("296866944860754376482796517102673")

            await ETH.functions.mint(addrToAccount(user0), expandDecimals(1, 8)).call()
            await transfer(ETH.as(user0), contrToAccount(vault), expandDecimals(1, 8))
            await vault
                .connect(user0)
                .functions.increase_position(
                    addrToAccount(user0),
                    toAsset(ETH),
                    toAsset(ETH),
                    "4746470050780000000000000000000000",
                    true,
                )
                .addContracts(attachedContracts)
                .call()

            position = formatObj(
                await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(ETH), toAsset(ETH), true)),
            )
            expect(position[0]).eq("9796792232002357947081599665915068") // size
            expect(position[2]).eq("2447397190894361457116367555285124") // averagePrice
        })
    })
})
