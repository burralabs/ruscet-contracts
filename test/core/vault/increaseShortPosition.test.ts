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

use(useChai)

describe("Vault.increaseShortPosition", function () {
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

    it("increasePosition short validations", async () => {
        await call(BNBPricefeed.functions.set_latest_answer(toPrice(300)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))
        await expect(
            vault
                .connect(user1)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), 0, false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInvalidMsgCaller")
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortCollateralAssetNotWhitelisted")
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BNB), toAsset(BNB), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortCollateralAssetMustBeStableAsset")

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(DAI), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortIndexAssetMustNotBeStableAsset")

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortIndexAssetNotShortable")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(
            vaultStorage.functions.set_asset_config(
                toAsset(BTC), // _token
                8, // _tokenDecimals
                10000, // _tokenWeight
                75, // _minProfitBps
                0, // _maxRusdAmount
                false, // _isStable
                false, // _isShortable
            ),
        )

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultShortIndexAssetNotShortable")

        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInsufficientCollateralForFees")
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), 0, false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInvalidPositionSize")

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(9, 7))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultInsufficientCollateralForFees")

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(4))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultLossesExceedCollateral")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultLiquidationFeesExceedCollateral")

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(6))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(8), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultSizeMustBeMoreThanCollateral")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(600), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultMaxLeverageExceeded")

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")
    })

    it("increasePosition short", async () => {
        await call(vaultStorage.functions.set_max_global_short_size(toAsset(BTC), toUsd(300)))

        let globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("0")

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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(60000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await call(BNBPricefeed.functions.set_latest_answer(toPrice(1000)))
        await call(vaultStorage.functions.set_asset_config(...getBnbConfig(BNB)))

        await call(DAIPricefeed.functions.set_latest_answer(toPrice(1)))
        await call(vaultStorage.functions.set_asset_config(...getDaiConfig(DAI)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(500))

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(99), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultSizeMustBeMoreThanCollateral")

        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(501), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("0")

        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(DAI)))).eq("0")
        await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(DAI)))).eq(
            "499800000000000000000000000000000",
        )

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq("0")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("49980000000")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("49980000000")

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(20))
        await expect(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(501), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultReserveExceedsPool")

        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(BTC)))).eq("0")

        let position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq("0") // size
        expect(position[1]).eq("0") // collateral
        expect(position[2]).eq("0") // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq("0") // reserveAmount
        expect(position[5].value).eq("0") // realisedPnl
        expect(position[6]).eq(true) // hasProfit
        expect(position[7]).eq("0") // lastIncreasedTime

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(90), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("49980000000")
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq(expandDecimals(90))
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_redemption_collateral_usd(toAsset(DAI)))).eq(
            "499800000000000000000000000000000",
        )

        let timestamp = await getValStr(utils.functions.get_unix_timestamp())

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(19.91)) // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(90)) // reserveAmount
        expect(position[5].value).eq("0") // realisedPnl
        expect(position[6]).eq(true) // hasProfit
        let lastIncreasedTime = BigNumber.from(position[7])
        // timestamp is within a deviation of 2 (actually: 1), so account for that here
        expect(lastIncreasedTime.gte(BigNumber.from(timestamp).sub(2)) && lastIncreasedTime.lte(BigNumber.from(timestamp).add(2)))
            .to.be.true // lastIncreasedTime

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("29000000") // 0.29
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("49980000000") // 0.29
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("49980000000") // 499.8

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(90))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(2.25))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50205000000")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("49980000000")

        let delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(2.25))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(42000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(42000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(42000)))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(4.5))

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(4.5))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50430000000") // 499.8 + 4.5
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("50430000000") // 499.8 + 4.5

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

        position = formatObj(
            await getValue(vaultUtils.functions.get_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(14.41)) // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(40)) // reserveAmount
        expect(position[5].value).eq(toUsd(2.5)) // realisedPnl
        expect(position[6]).eq(false) // hasProfit
        // timestamp is within a deviation of 2 (actually: 1), so account for that here
        expect(lastIncreasedTime.gte(BigNumber.from(timestamp).sub(2)) && lastIncreasedTime.lte(BigNumber.from(timestamp).add(2)))
            .to.be.true // lastIncreasedTime

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(2))

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("34000000") // 0.18
        expect(await getValStr(vaultUtils.functions.get_rusd_amount(toAsset(DAI)))).eq("49980000000") // 499.8
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("50230000000") // 502.3

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(40))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(2))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50430000000") // 499.8 + 4.5
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("50430000000") // 499.8 + 4.5

        await call(DAI.functions.mint(contrToAccount(vault), expandDecimals(50)))
        await call(
            vault
                .connect(user1)
                .functions.increase_position(addrToAccount(user1), toAsset(DAI), toAsset(BTC), toUsd(200), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(240))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(
            "41652892561983471074380165289256198",
        )

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(2))
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50430000000") // 502.3 + 2
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("50430000000") // 502.3 + 2

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(1))

        delta = formatObj(
            await getValue(vaultUtils.functions.get_position_delta(addrToAccount(user1), toAsset(DAI), toAsset(BTC), false)),
        )
        expect(delta[0]).eq(true)
        expect(delta[1]).eq("4761904761904761904761904761904") // 4.76

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(true)
        expect(await globalDelta[1]).eq("3761904761904761904761904761904")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("49853809523") // 502.3 + 1 - 4.76 => 498.53
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("49277619047") // 492.77619047619047619

        await call(DAI.functions.mint(contrToAccount(vault), expandDecimals(20)))
        await call(
            vault
                .connect(user2)
                .functions.increase_position(addrToAccount(user2), toAsset(DAI), toAsset(BTC), toUsd(60), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(300))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(
            "41311475409836065573770491803278614",
        )

        globalDelta = formatObj(await getValue(vaultUtils.functions.get_global_short_delta(toAsset(BTC))))
        expect(await globalDelta[0]).eq(true)
        expect(await globalDelta[1]).eq("2261904761904761904761904761904")
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(true))).eq("50003809523") // 500.038095238095238095
        expect(await getValStr(rlpManager.functions.get_aum_in_rusd(false))).eq("49277619047") // 492.77619047619047619

        await call(DAI.functions.mint(contrToAccount(vault), expandDecimals(20)))

        await expect(
            vault
                .connect(user2)
                .functions.increase_position(addrToAccount(user2), toAsset(DAI), toAsset(BTC), toUsd(60), false)
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("VaultMaxShortsExceeded")

        await call(
            vault
                .connect(user2)
                .functions.increase_position(addrToAccount(user2), toAsset(DAI), toAsset(BNB), toUsd(60), false)
                .addContracts(attachedContracts),
        )
    })
})
