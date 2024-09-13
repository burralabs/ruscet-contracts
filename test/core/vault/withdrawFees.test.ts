import { expect, use } from "chai"
import { AbstractContract, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    Fungible,
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
import { deploy, getBalance, getValStr, call } from "../../utils/utils"
import { addrToAccount, contrToAccount, toContract } from "../../utils/account"
import { expandDecimals, toPrice, toUsd } from "../../utils/units"
import { getAssetId, toAsset, transfer } from "../../utils/asset"
import { useChai } from "../../utils/chai"
import { getBnbConfig, getBtcConfig } from "../../utils/vault"
import { WALLETS } from "../../utils/wallets"

use(useChai)

describe("Vault.withdrawFees", function () {
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
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
    let RUSD: string // the RUSD fungible asset
    let router: Router
    let vaultPricefeed: VaultPricefeed
    let timeDistributor: TimeDistributor
    let yieldTracker: YieldTracker
    let utils: Utils

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

        attachedContracts = [vaultUtils, vaultStorage]

        RUSD = getAssetId(rusd)

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
    })

    it("withdrawFees", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(900)))
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(900))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("26919000000000") // 269,190 RUSD, 810 fee
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("270000000") // 2.7, 900 * 0.3%
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3
        expect(await getValStr(rusd.functions.total_supply())).eq("26919000000000")

        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(200)))
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(200))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)))
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("11964000000000") // 119,640
        expect(await getValStr(rusd.functions.total_supply())).eq("38883000000000") // 388,830

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)))
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("23928000000000") // 239,280
        expect(await getValStr(rusd.functions.total_supply())).eq("50847000000000") // 508,470

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts))

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("32901000000000") // 329,010
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("109670000000") // 1096.7

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("330000000") // 3.3 BNB
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("1200000") // 0.012 BTC

        await expect(vault.connect(user0).functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).call()).to.be.revertedWith(
            "VaultForbiddenNotGov",
        )

        expect(await getBalance(user2, BNB)).eq("0")
        await call(vault.functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).addContracts(attachedContracts))
        expect(await getBalance(user2, BNB)).eq("330000000")

        expect(await getBalance(user2, BTC)).eq("0")
        await call(vault.functions.withdraw_fees(toAsset(BTC), addrToAccount(user2)).addContracts(attachedContracts))
        expect(await getBalance(user2, BTC)).eq("1200000")
    })

    /*
    it("withdrawFees using timelock", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(900)))
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(900))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("26919000000000") // 269,190 RUSD, 810 fee
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("270000000") // 2.7, 900 * 0.3%
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3
        expect(await getValStr(rusd.functions.total_supply())).eq("26919000000000")

        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(200)))
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(200))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)))
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("11964000000000") // 119,640
        expect(await getValStr(rusd.functions.total_supply())).eq("38883000000000") // 388,830

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)))
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("23928000000000") // 239,280
        expect(await getValStr(rusd.functions.total_supply())).eq("50847000000000") // 508,470

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)))

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("32901000000000") // 329,010
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("109670000000") // 1096.7

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("330000000") // 3.3 BNB
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("1200000") // 0.012 BTC

        await expect(vault.connect(user0).functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).call()).to.be.revertedWith(
            "VaultForbiddenNotGov",
        )

        timelock = await deploy("Timelock", deployer)
        await call(timelock.functions
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
            ))
        await call(vaultStorage.functions.set_gov(contrToAccount(timelock.id)))

        await expect(
            timelock.connect(user0).functions.withdraw_fees(contrToAccount(vault), toAsset(BNB), addrToAccount(user2)).call(),
        ).to.be.revertedWith("TimelockForbiddenNotGov")

        expect(await getBalance(user2, BNB)).eq("0")
        await call(timelock.functions.withdraw_fees(contrToAccount(vault), toAsset(BNB), addrToAccount(user2)))
        expect(await getBalance(user2, BNB)).eq("330000000")

        expect(await getBalance(user2, BTC)).eq("0")
        await call(timelock.functions.withdraw_fees(contrToAccount(vault), toAsset(BTC), addrToAccount(user2)))
        expect(await getBalance(user2, BTC)).eq("1200000")
    })

    it("batchWithdrawFees using timelock", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(900)))
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(900))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("0")
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("0")

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)))

        expect(await getBalance(deployer, RUSD)).eq("0")
        expect(await getBalance(user1, RUSD)).eq("26919000000000") // 269,190 RUSD, 810 fee
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("270000000") // 2.7, 900 * 0.3%
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3
        expect(await getValStr(rusd.functions.total_supply())).eq("26919000000000")

        await call(BNB.functions.mint(addrToAccount(user0), expandDecimals(200)))
        await transfer(BNB.as(user0), contrToAccount(vault), expandDecimals(200))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)))
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("11964000000000") // 119,640
        expect(await getValStr(rusd.functions.total_supply())).eq("38883000000000") // 388,830

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(2, 8)))
        await transfer(BTC.as(user0), contrToAccount(vault), expandDecimals(2, 8))

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BTC), addrToAccount(user1)))
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BTC)))).eq("23928000000000") // 239,280
        expect(await getValStr(rusd.functions.total_supply())).eq("50847000000000") // 508,470

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("26919000000000") // 269,190
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("89730000000") // 897.3

        await call(vault.connect(user0).functions.buy_rusd(toAsset(BNB), addrToAccount(user1)))

        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(BNB)))).eq("32901000000000") // 329,010
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(BNB)))).eq("109670000000") // 1096.7

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BNB)))).eq("330000000") // 3.3 BNB
        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(BTC)))).eq("1200000") // 0.012 BTC

        await expect(vault.connect(user0).functions.withdraw_fees(toAsset(BNB), addrToAccount(user2)).call()).to.be.revertedWith(
            "VaultForbiddenNotGov",
        )

        timelock = await deploy("Timelock", deployer)
        await call(timelock.functions
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
            ))
        // maybe outsource this to a function in Vault?
        await call(vaultStorage1.functions.set_gov(contrToAccount(timelock.id)))
        await call(vaultStorage2.functions.set_gov(contrToAccount(timelock.id)))

        await expect(
            timelock
                .connect(user0)
                .functions.batch_withdraw_fees(contrToAccount(vault), [toAsset(BNB), toAsset(BTC)])
                .call(),
        ).to.be.revertedWith("TimelockForbiddenOnlyKeeperAndAbove")

        expect(await getBalance(deployer, BNB)).eq("0")
        expect(await getBalance(deployer, BTC)).eq("0")

        expect((await timelock.functions.get_gov().call()).value.value.toString()).eq(contrToAccount(deployer).value)
        await call(timelock.functions.batch_withdraw_fees(contrToAccount(vault), [toAsset(BNB), toAsset(BTC)]))

        // expect(await getBalance(deployer, BNB)).eq("330000000")
        // expect(await getBalance(deployer, BTC)).eq("1200000")
    })
    */
})
