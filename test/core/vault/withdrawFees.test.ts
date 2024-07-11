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

describe("Vault.withdrawFees", function () {
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
    let RUSD: string // the RUSD fungible asset
    let router: RouterAbi
    let vaultPricefeed: VaultPricefeedAbi
    let timeDistributor: TimeDistributorAbi
    let yieldTracker: YieldTrackerAbi
    // let timelock: TimelockAbi

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

        attachedContracts = [vaultUtils, vaultStorage]

        RUSD = getAssetId(rusd)

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
    })

    it("withdrawFees", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(900)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(900))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("26919000000000") // 269,190 RUSD, 810 fee
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("270000000") // 2.7, 900 * 0.3%
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3
        expect(await getValStr(rusd.functions.total_supply())).eq("26919000000000")

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(200)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(200))

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)).call()
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("11964000000000") // 119,640
        expect(await getValStr(rusd.functions.total_supply())).eq("38883000000000") // 388,830

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)).call()
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts).call()
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("23928000000000") // 239,280
        expect(await getValStr(rusd.functions.total_supply())).eq("50847000000000") // 508,470

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3

        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("32901000000000") // 329,010
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("109670000000") // 1096.7

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("330000000") // 3.3 BNB
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("1200000") // 0.012 BTC

        await expect(vault.connect(user0).functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).call()).to.be.revertedWith(
            "VaultForbiddenNotGov",
        )

        expect(await getBalance(user2, BNB)).eq("0")
        await vault.functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).addContracts(attachedContracts).call()
        expect(await getBalance(user2, BNB)).eq("330000000")

        expect(await getBalance(user2, BTC)).eq("0")
        await vault.functions.withdraw_fees(toAsset(BTC), addrToAccount(user2)).addContracts(attachedContracts).call()
        expect(await getBalance(user2, BTC)).eq("1200000")
    })

    /*
    it("withdrawFees using timelock", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(900)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(900))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).call()

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("26919000000000") // 269,190 RUSD, 810 fee
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("270000000") // 2.7, 900 * 0.3%
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3
        expect(await getValStr(rusd.functions.total_supply())).eq("26919000000000")

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(200)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(200))

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)).call()
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).call()
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("11964000000000") // 119,640
        expect(await getValStr(rusd.functions.total_supply())).eq("38883000000000") // 388,830

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)).call()
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).call()
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("23928000000000") // 239,280
        expect(await getValStr(rusd.functions.total_supply())).eq("50847000000000") // 508,470

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3

        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).call()

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("32901000000000") // 329,010
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("109670000000") // 1096.7

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("330000000") // 3.3 BNB
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("1200000") // 0.012 BTC

        await expect(vault.connect(user0).functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).call()).to.be.revertedWith(
            "VaultForbiddenNotGov",
        )

        timelock = await deploy("Timelock", deployer)
        await timelock.functions
            .initialize(
                addrToAccount(deployer), // _admin
                5 * 24 * 60 * 60, // _buffer
                addrToAccount(user0), // _tokenManager
                addrToAccount(user1), // _mintReceiver
                addrToAccount(user2), // _rlpManager
                addrToAccount(user2), // _prevRlpManager
                addrToAccount(user3), // _rewardRouter
                expandDecimals(1000), // _maxTokenSupply
                10, // marginFeeBasisPoints
                100, // maxMarginFeeBasisPoints
            )
            .call()
        await vaultStorage.functions.set_gov(contrToAccount(timelock.id)).call()

        await expect(
            timelock.connect(user0).functions.withdraw_fees(contrToAccount(vault), toAsset(BNB), addrToAccount(user2)).call(),
        ).to.be.revertedWith("TimelockForbiddenNotGov")

        expect(await getBalance(user2, BNB)).eq("0")
        await timelock.functions.withdraw_fees(contrToAccount(vault), toAsset(BNB), addrToAccount(user2)).call()
        expect(await getBalance(user2, BNB)).eq("330000000")

        expect(await getBalance(user2, BTC)).eq("0")
        await timelock.functions.withdraw_fees(contrToAccount(vault), toAsset(BTC), addrToAccount(user2)).call()
        expect(await getBalance(user2, BTC)).eq("1200000")
    })

    it("batchWithdrawFees using timelock", async () => {
        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
        await vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)).call()

        await BTCPricefeed.functions.set_latest_answer(toPrice(60000)).call()
        await vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(900)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(900))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).call()

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("26919000000000") // 269,190 RUSD, 810 fee
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("270000000") // 2.7, 900 * 0.3%
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3
        expect(await getValStr(rusd.functions.total_supply())).eq("26919000000000")

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(200)).call()
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(200))

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)).call()
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).call()
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("11964000000000") // 119,640
        expect(await getValStr(rusd.functions.total_supply())).eq("38883000000000") // 388,830

        await BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)).call()
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).call()
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("23928000000000") // 239,280
        expect(await getValStr(rusd.functions.total_supply())).eq("50847000000000") // 508,470

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3

        await vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).call()

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("32901000000000") // 329,010
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("109670000000") // 1096.7

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("330000000") // 3.3 BNB
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("1200000") // 0.012 BTC

        await expect(vault.connect(user0).functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).call()).to.be.revertedWith(
            "VaultForbiddenNotGov",
        )

        timelock = await deploy("Timelock", deployer)
        await timelock.functions
            .initialize(
                addrToAccount(deployer), // _admin
                5 * 24 * 60 * 60, // _buffer
                addrToAccount(user0), // _tokenManager
                addrToAccount(user1), // _mintReceiver
                contrToAccount(user2), // _rlpManager
                contrToAccount(user2), // _prevRlpManager
                contrToAccount(user3), // _rewardRouter
                expandDecimals(1000), // _maxTokenSupply
                10, // marginFeeBasisPoints
                100, // maxMarginFeeBasisPoints
            )
            .call()
        // maybe outsource this to a function in Vault?
        await vaultStorage1.functions.set_gov(contrToAccount(timelock.id)).call()
        await vaultStorage2.functions.set_gov(contrToAccount(timelock.id)).call()

        await expect(
            timelock
                .connect(user0)
                .functions.batch_withdraw_fees(contrToAccount(vault), [toAsset(BNB), toAsset(BTC)])
                .call(),
        ).to.be.revertedWith("TimelockForbiddenOnlyKeeperAndAbove")

        expect(await getBalance(deployer, BNB)).eq("0")
        expect(await getBalance(deployer, BTC)).eq("0")

        expect((await timelock.functions.get_gov().call()).value.value.toString()).eq(contrToAccount(deployer).value)
        await timelock.functions.batch_withdraw_fees(contrToAccount(vault), [toAsset(BNB), toAsset(BTC)]).call()

        // expect(await getBalance(deployer, BNB)).eq("330000000")
        // expect(await getBalance(deployer, BTC)).eq("1200000")
    })
    */
})
