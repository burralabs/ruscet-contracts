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
import { getPositionLeverage } from "../../utils/contract"

use(useChai)

describe("Vault.liquidateLongPosition", () => {
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
                toContract(rusd), // RUSD contract
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

    it("liquidate long", async () => {
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
                    .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultEmptyPosition")

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)))
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD

        await call(vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))

        await call(BTC.functions.mint(addrToAccount(user0), expandDecimals(1, 8)))
        await transfer(BTC.as(user1), contrToAccount(vault), 25000) // 0.00025 BTC => 10 USD

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

        expect(
            formatObj(
                await getValue(
                    vaultUtils.functions.validate_liquidation(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, false),
                ),
            )[0],
        ).eq("0")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))

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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
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

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await expect(
            call(
                vault.functions
                    .liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(38700)))
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

        await expect(
            call(
                vault
                    .connect(user1)
                    .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultInvalidLiquidator")

        expect(await getValue(vaultStorage.functions.is_liquidator(addrToAccount(user1)))).eq(false)
        await call(vaultStorage.functions.set_liquidator(addrToAccount(user1), true))
        expect(await getValue(vaultStorage.functions.is_liquidator(addrToAccount(user1)))).eq(true)

        await call(
            vault
                .connect(user1)
                .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                .addContracts(attachedContracts),
        )

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

        await call(vault.functions.withdraw_fees(toAsset(BTC), addrToAccount(user0)).addContracts(attachedContracts))

        await call(BTC.functions.mint(contrToAccount(vault), 1000))
        await call(vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))
    })

    it("automatic stop-loss", async () => {
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
                    .functions.liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultEmptyPosition")

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)))
        await transfer(BTC.as(user1), contrToAccount(vault), 5000000) // 0.05 BTC => 2000 USD
        await call(vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))

        await call(BTC.functions.mint(addrToAccount(user1), expandDecimals(1, 8)))
        await transfer(BTC.as(user1), contrToAccount(vault), 250000) // 0.0025 BTC => 100 USD
        await call(
            vault
                .connect(user0)
                .functions.increase_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), toUsd(1000), true)
                .addContracts(attachedContracts),
        )

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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(43500)))

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

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(39000)))
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

        await call(vaultStorage.functions.set_liquidator(addrToAccount(deployer), true))
        await expect(
            call(
                vault.functions
                    .liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                    .addContracts(attachedContracts),
            ),
        ).to.be.revertedWith("VaultPositionCannotBeLiquidated")

        await call(BTCPricefeed.functions.set_latest_answer(toPrice(37760)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(37760)))
        await call(BTCPricefeed.functions.set_latest_answer(toPrice(37760)))

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

        await call(
            vault.functions
                .liquidate_position(addrToAccount(user0), toAsset(BTC), toAsset(BTC), true, addrToAccount(user2))
                .addContracts(attachedContracts),
        )

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

        await call(vault.functions.withdraw_fees(toAsset(BTC), addrToAccount(user0)).addContracts(attachedContracts))

        await call(BTC.functions.mint(contrToAccount(vault), 1000))
        await call(vault.functions.buy_rusd(toAsset(BTC), addrToAccount(user1)).addContracts(attachedContracts))
    })
})
