import { expect, use } from "chai"
import { AbstractContract, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    Fungible,
    Rlp,
    Pricefeed,
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

describe("Vault.liquidateShortPosition", function () {
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

    let vaultPricefeed: VaultPricefeed
    let timeDistributor: TimeDistributor
    let yieldTracker: YieldTracker
    let rlp: Rlp
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
        vault = await deploy("Vault", deployer, {
            VAULT_STORAGE: toContract(vaultStorage),
            VAULT_UTILS: toContract(vaultUtils),
        })
        vaultPricefeed = await deploy("VaultPricefeed", deployer)
        rusd = await deploy("Rusd", deployer)
        timeDistributor = await deploy("TimeDistributor", deployer)
        yieldTracker = await deploy("YieldTracker", deployer)
        rlp = await deploy("Rlp", deployer)
        attachedContracts = [vaultUtils, vaultStorage]

        await call(rusd.functions.initialize(toContract(vault)))

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
        await call(vaultPricefeed.functions.set_asset_config(toAsset(DAI), toContract(DAIPricefeed), 8, false))
        await call(vaultPricefeed.functions.set_asset_config(toAsset(BTC), toContract(BTCPricefeed), 8, false))

        await call(rlp.functions.initialize())
    })

    it("liquidate short", async () => {
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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(vaultStorage.functions.set_liquidator(addrToAccount(user0), true))
        await expect(
            call(
                vault
                    .connect(user0)
                    .functions.liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultEmptyPosition")

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq("0")

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1000)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(100))
        await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(10))
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
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq("0") // entryFundingRate
        expect(position[4]).eq(expandDecimals(90)) // reserveAmount

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(90))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))

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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
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

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await expect(
            call(
                vault.functions
                    .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(42500)))
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

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await call(
            vault.functions
                .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
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

        expect(await getValStr(vaultStorage.functions.get_fee_reserves(toAsset(DAI)))).eq("22000000") // 0.22
        expect(await getValStr(vaultUtils.functions.get_reserved_amounts(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_guaranteed_usd(toAsset(DAI)))).eq("0")
        expect(await getValStr(vaultUtils.functions.get_pool_amounts(toAsset(DAI)))).eq("10478000000") // 104.78
        expect(await getBalance(user2, DAI)).eq(expandDecimals(5))

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(40000))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(20))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(100))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(50000))

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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(vaultStorage.functions.set_liquidator(addrToAccount(user0), true))
        await expect(
            call(
                vault
                    .connect(user0)
                    .functions.liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultEmptyPosition")

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq("0")

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1001)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(1001))
        await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(100)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(100))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts),
        )

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

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))

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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
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

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await expect(
            call(
                vault.functions
                    .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45000)))
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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43600)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43600)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43600)))
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

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await call(
            vault.functions
                .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(20)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(20))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(100))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(50000))

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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))
        await call(vaultStorage.functions.set_asset_config(...getBtcConfig(BTC)))

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(40000)))

        await call(vaultStorage.functions.set_liquidator(addrToAccount(user0), true))
        await expect(
            call(
                vault
                    .connect(user0)
                    .functions.liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultEmptyPosition")

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq("0")
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq("0")

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(1001)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(1001))
        await call(vault.functions.buy_rusd(toAsset(DAI), addrToAccount(user1)).addContracts(attachedContracts))

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(100)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(100))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(1000), false)
                .addContracts(attachedContracts),
        )

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

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, false),
                ),
            )[0],
        ).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))

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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(41000)))
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

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await expect(
            call(
                vault.functions.liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2)),
            ),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(45000)))
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

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await call(
            vault.functions
                .liquidate_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), false, addrToAccount(user2))
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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(50000)))

        await call(DAI.functions.mint(addrToAccount(user0), expandDecimals(20)))
        await transfer(DAI.as(user0), contrToAccount(vault), expandDecimals(20))
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(DAI), toAsset(BTC), toUsd(100), false)
                .addContracts(attachedContracts),
        )

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BTC)))).eq(toUsd(100))
        expect(await getValStr(vaultStorage.functions.get_global_short_average_prices(toAsset(BTC)))).eq(toNormalizedPrice(50000))

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
