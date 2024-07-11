import { expect, use } from "chai"
import { AbstractContract, BN, FUEL_NETWORK_URL, Provider, Wallet, WalletUnlocked } from "fuels"
import {
    BasePositionManagerAbi,
    FungibleAbi,
    RlpAbi,
    RlpManagerAbi,
    PositionRouterAbi,
    PricefeedAbi,
    ReferralStorageAbi,
    RouterAbi,
    ShortsTrackerAbi,
    TimeDistributorAbi,
    RusdAbi,
    UtilsAbi,
    VaultAbi,
    VaultPricefeedAbi,
    VaultStorageAbi,
    VaultUtilsAbi,
    YieldTrackerAbi,
} from "../../types"
import { TransferAssetsToContractAbi__factory } from "../../types/scripts"
import { deploy, formatObj, getValStr, getValue } from "../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../utils/account"
import { expandDecimals, toPrice, toUsd } from "../utils/units"
import { ZERO_B256 } from "../utils/constants"
import { getAssetId, toAsset, transfer } from "../utils/asset"
import { useChai } from "../utils/chai"
import { WALLETS } from "../utils/wallets"
import { getDaiConfig, getEthConfig } from "../utils/vault"
import { BASE_ASSET_ID, minExecutionFee } from "../../deployment/utils"
import { log } from "console"

use(useChai)

describe("PositionRouter", () => {
    const depositFee = "50"
    const referralCode = ZERO_B256

    let localProvider: Provider
    let attachedContracts: AbstractContract[]
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let utils: UtilsAbi
    let USDC: FungibleAbi
    let USDCPricefeed: PricefeedAbi
    let DAI: FungibleAbi
    let DAIPricefeed: PricefeedAbi
    let BNB: FungibleAbi
    let BNBPricefeed: PricefeedAbi
    let vault: VaultAbi
    let vaultStorage: VaultStorageAbi
    let vaultUtils: VaultUtilsAbi
    let rusd: RusdAbi
    let RUSD: string // the RUSD fungible asset
    let router: RouterAbi
    let vaultPricefeed: VaultPricefeedAbi
    let timeDistributor: TimeDistributorAbi
    let yieldTracker: YieldTrackerAbi
    let rlp: RlpAbi
    let rlpManager: RlpManagerAbi
    let shortsTracker: ShortsTrackerAbi
    let positionRouter: PositionRouterAbi
    let positionRouterBPM: BasePositionManagerAbi
    let referralStorage: ReferralStorageAbi

    beforeEach(async () => {
        localProvider = await Provider.create(FUEL_NETWORK_URL)

        const wallets = WALLETS.map((k) => Wallet.fromPrivateKey(k, localProvider))

        ;[deployer, user0, user1, user2, user3] = wallets

        /*
            NativeAsset + Pricefeed
        */
        USDC = (await deploy("Fungible", deployer)) as FungibleAbi
        USDCPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        DAI = (await deploy("Fungible", deployer)) as FungibleAbi
        DAIPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        BNB = (await deploy("Fungible", deployer)) as FungibleAbi
        BNBPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        await USDCPricefeed.functions.initialize(addrToAccount(deployer), "USDC Pricefeed").call()
        await DAIPricefeed.functions.initialize(addrToAccount(deployer), "DAI Pricefeed").call()
        await BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed").call()

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
        shortsTracker = await deploy("ShortsTracker", deployer)
        positionRouterBPM = await deploy("BasePositionManager", deployer)
        positionRouter = await deploy("PositionRouter", deployer)
        referralStorage = await deploy("ReferralStorage", deployer)

        attachedContracts = [
            vault,
            vaultUtils,
            vaultStorage,
            vaultPricefeed,
            positionRouterBPM,
            shortsTracker,
            router,
            referralStorage,
            USDCPricefeed,
            DAIPricefeed,
            BNBPricefeed,
        ]

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
        await vault.functions
            .initialize(addrToAccount(deployer), toContract(vaultUtils), toContract(vaultStorage))
            .addContracts(attachedContracts)
            .call()
        await vaultStorage.functions.write_authorize(contrToAccount(vault), true).call()
        await vaultStorage.functions.write_authorize(contrToAccount(vaultUtils), true).call()
        await vaultUtils.functions.write_authorize(contrToAccount(vault), true).call()

        await yieldTracker.functions.initialize(toContract(rusd)).call()
        await yieldTracker.functions.set_time_distributor(toContract(timeDistributor)).call()
        await timeDistributor.functions.initialize().call()
        await timeDistributor.functions.set_distribution([contrToAccount(yieldTracker)], [1000], [toAsset(USDC)]).call()

        await USDC.functions.mint(contrToAccount(timeDistributor), 5000).call()
        await rusd.functions.set_yield_trackers([{ bits: contrToAccount(yieldTracker).value }]).call()

        await vaultPricefeed.functions.initialize(addrToAccount(deployer)).call()
        await vaultPricefeed.functions.set_asset_config(toAsset(USDC), toContract(USDCPricefeed), 8, false).call()
        await vaultPricefeed.functions.set_asset_config(toAsset(DAI), toContract(DAIPricefeed), 8, false).call()
        await vaultPricefeed.functions.set_asset_config(toAsset(BNB), toContract(BNBPricefeed), 8, false).call()

        await vaultStorage.functions.set_asset_config(...getDaiConfig(USDC)).call()
        await vaultStorage.functions.set_asset_config(...getEthConfig(BNB)).call()

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

        await referralStorage.functions.initialize().call()
        await referralStorage.functions.set_handler(contrToAccount(positionRouter), true).call()

        await shortsTracker.functions.initialize(toContract(vault)).call()
        await shortsTracker.functions.set_handler(contrToAccount(positionRouter), true).call()
        await shortsTracker.functions.set_handler(contrToAccount(positionRouterBPM), true).call()

        await router.functions.set_plugin(toContract(positionRouterBPM), true).call()

        await positionRouterBPM.functions
            .initialize(
                addrToAccount(deployer),
                toContract(vault),
                toContract(router),
                toContract(shortsTracker),
                toContract(referralStorage),
                depositFee /* 0.3% */,
            )
            .call()
        await positionRouter.functions.initialize(toContract(positionRouterBPM), toContract(vault)).call()
        await positionRouterBPM.functions.register_child(toContract(positionRouter)).call()

        await USDCPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await DAIPricefeed.functions.set_latest_answer(toPrice(1)).call()
        await BNBPricefeed.functions.set_latest_answer(toPrice(300)).call()
    })

    it("transferAssetsToContractTest - script", async () => {
        const script = TransferAssetsToContractAbi__factory.createInstance(deployer)

        await BNB.functions.mint(addrToAccount(deployer), expandDecimals(100, 8)).call()

        const contrBalBefore = (await utils.functions.get_contr_balance(toContract(vault), toAsset(BNB)).call()).value.toString()
        const balBefore = (await localProvider.getBalance(deployer.address, getAssetId(BNB))).toString()
        expect(balBefore).to.equal(expandDecimals(100, 8).toString())
        expect(contrBalBefore).to.equal("0")

        await script.functions
            .main(toAsset(BNB), expandDecimals(1, 8), toContract(vault))
            .callParams({
                forward: [expandDecimals(1, 8), getAssetId(BNB)],
            })
            .call()

        const balAfter = (await localProvider.getBalance(deployer.address, getAssetId(BNB))).toString()
        const contrBalAfter = (await utils.functions.get_contr_balance(toContract(vault), toAsset(BNB)).call()).value.toString()

        expect(balAfter).to.equal("9900000000")
        expect(contrBalAfter).to.equal(expandDecimals(1, 8).toString())
    })

    it("transferAssetsToContractTest - contract", async () => {
        await BNB.functions.mint(addrToAccount(deployer), expandDecimals(100, 8)).call()

        const contrBalBefore = (await utils.functions.get_contr_balance(toContract(vault), toAsset(BNB)).call()).value.toString()
        const balBefore = (await localProvider.getBalance(deployer.address, getAssetId(BNB))).toString()
        expect(balBefore).to.equal(expandDecimals(100, 8).toString())
        expect(contrBalBefore).to.equal("0")

        await utils.functions
            .transfer_assets_to_contract(toAsset(BNB), expandDecimals(1, 8), toContract(vault))
            .callParams({
                forward: [expandDecimals(1, 8), getAssetId(BNB)],
            })
            .call()

        const balAfter = (await localProvider.getBalance(deployer.address, getAssetId(BNB))).toString()
        const contrBalAfter = (await utils.functions.get_contr_balance(toContract(vault), toAsset(BNB)).call()).value.toString()

        expect(balAfter).to.equal("9900000000")
        expect(contrBalAfter).to.equal(expandDecimals(1, 8).toString())
    })

    it("withdrawFees", async () => {
        await BNB.functions.mint(contrToAccount(vault), expandDecimals(30)).call()
        await vault
            .multiCall([
                utils.functions.update_price_data(toContract(vaultPricefeed), [
                    { asset_id: toAsset(USDC), price: toPrice(1) },
                    { asset_id: toAsset(DAI), price: toPrice(1) },
                    { asset_id: toAsset(BNB), price: toPrice(300) },
                ]),
                vault.functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts),
            ])
            .call()

        await router.as(user0).functions.set_approved_plugins(toContract(positionRouterBPM), true).call()

        await USDC.functions.mint(addrToAccount(user0), expandDecimals(700)).call()
        await USDC.functions.mint(addrToAccount(deployer), expandDecimals(700)).call()

        const amountIn = expandDecimals(600)

        console.log("Assets:", [toAsset(USDC), toAsset(DAI), toAsset(BNB)])
        console.log("Pricefeeds:", [toContract(USDCPricefeed), toContract(DAIPricefeed), toContract(BNBPricefeed)])
        const { value } = await positionRouter
            .as(user0)
            .multiCall([
                utils.functions.transfer_assets_to_contract(toAsset(USDC), amountIn, toContract(positionRouter)).callParams({
                    forward: [amountIn, getAssetId(USDC)],
                }),
                utils.functions.update_price_data(toContract(vaultPricefeed), [
                    { asset_id: toAsset(USDC), price: toPrice(1) },
                    { asset_id: toAsset(DAI), price: toPrice(1) },
                    { asset_id: toAsset(BNB), price: toPrice(300) },
                ]),
                positionRouter.functions
                    .increase_position(
                        [toAsset(USDC), toAsset(BNB)], // path
                        toAsset(BNB), // index_asset
                        amountIn, // amountIn
                        expandDecimals(1), // minOut
                        toUsd(6000), // size_delta
                        true, // is_long
                        toUsd(300), // acceptablePrice
                        referralCode, // referralCode
                    )
                    .addContracts(attachedContracts),
            ])
            .call()

        // ---------------------------------

        expect(await getValStr(positionRouterBPM.functions.get_fee_reserves(toAsset(BNB)))).eq("0")

        await USDC.functions.mint(addrToAccount(user0), expandDecimals(600)).call()

        const tx = positionRouter.as(user0).multiCall([
            utils.functions.transfer_assets_to_contract(toAsset(USDC), amountIn, toContract(positionRouter)).callParams({
                forward: [amountIn, getAssetId(USDC)],
            }),
            positionRouter
                .as(user0)
                .functions.increase_position(
                    [toAsset(USDC), toAsset(BNB)], // path
                    toAsset(BNB), // index_asset
                    amountIn, // amountIn
                    expandDecimals(1), // minOut
                    toUsd(0), // size_delta
                    true, // is_long
                    toUsd(300), // acceptablePrice
                    referralCode, // referralCode
                )
                .addContracts(attachedContracts),
        ])
        const { gasUsed } = await tx.getTransactionCost()
        const gasLimit = gasUsed.mul("6").div("5").toString()
        await tx.txParams({ gasLimit }).call()

        expect(await getValStr(positionRouterBPM.functions.get_fee_reserves(toAsset(DAI)))).eq("0")
        expect(await getValStr(positionRouterBPM.functions.get_fee_reserves(toAsset(BNB)))).eq("997000") // 0.00997

        await expect(
            positionRouterBPM.as(user2).functions.withdraw_fees(toAsset(USDC), addrToAccount(user3)).call(),
        ).to.be.revertedWith("BPMForbidden")

        await positionRouterBPM.functions.set_gov(addrToAccount(user2)).call()

        expect((await localProvider.getBalance(user3.address, getAssetId(USDC))).toString()).eq("0")
        expect((await localProvider.getBalance(user3.address, getAssetId(BNB))).toString()).eq("0")

        await positionRouterBPM.as(user2).functions.withdraw_fees(toAsset(USDC), addrToAccount(user3)).call()

        expect(await getValStr(positionRouterBPM.functions.get_fee_reserves(toAsset(DAI)))).eq("0")
        expect(await getValStr(positionRouterBPM.functions.get_fee_reserves(toAsset(BNB)))).eq("997000") // 0.00997

        expect((await localProvider.getBalance(user3.address, getAssetId(USDC))).toString()).eq("0")
        expect((await localProvider.getBalance(user3.address, getAssetId(BNB))).toString()).eq("0")

        await positionRouterBPM.as(user2).functions.withdraw_fees(toAsset(BNB), addrToAccount(user3)).call()

        expect((await localProvider.getBalance(user3.address, getAssetId(USDC))).toString()).eq("0")
        expect((await localProvider.getBalance(user3.address, getAssetId(BNB))).toString()).eq("997000")

        expect(await getValStr(positionRouterBPM.functions.get_fee_reserves(toAsset(DAI)))).eq("0")
        expect(await getValStr(positionRouterBPM.functions.get_fee_reserves(toAsset(BNB)))).eq("0")
    })

    it("decreasePosition acceptablePrice long", async () => {
        await BNB.functions.mint(contrToAccount(vault), expandDecimals(30)).call()
        await vault.functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        await router.as(user0).functions.set_approved_plugins(toContract(positionRouterBPM), true).call()

        await USDC.functions.mint(addrToAccount(user0), expandDecimals(700)).call()
        await USDC.functions.mint(addrToAccount(deployer), expandDecimals(700)).call()

        const amountIn = expandDecimals(600)

        const { value } = await positionRouter
            .as(user0)
            .multiCall([
                utils.functions.transfer_assets_to_contract(toAsset(USDC), amountIn, toContract(positionRouter)).callParams({
                    forward: [amountIn, getAssetId(USDC)],
                }),
                positionRouter.functions
                    .increase_position(
                        [toAsset(USDC), toAsset(BNB)], // path
                        toAsset(BNB), // index_asset
                        amountIn, // amountIn
                        expandDecimals(1), // minOut
                        toUsd(6000), // size_delta
                        true, // is_long
                        toUsd(300), // acceptablePrice
                        referralCode, // referralCode
                    )
                    .addContracts(attachedContracts),
            ])
            .call()

        // Decrease position
        await expect(
            positionRouter
                .as(user0)
                .functions.decrease_position(
                    [toAsset(BNB), toAsset(USDC)], // path
                    toAsset(BNB), // index_asset
                    toUsd(300), // collateralDelta
                    toUsd(1000), // sizeDelta
                    true, // is_long
                    addrToAccount(user1), // receiver
                    toUsd(310), // acceptablePrice
                    0, // minOut
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("BPMMarkPriceLtPrice")
    })

    it("decreasePosition minOut long", async () => {
        await BNB.functions.mint(contrToAccount(vault), expandDecimals(30)).call()
        await vault.functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        await router.as(user0).functions.set_approved_plugins(toContract(positionRouterBPM), true).call()

        await USDC.functions.mint(addrToAccount(user0), expandDecimals(700)).call()
        await USDC.functions.mint(addrToAccount(deployer), expandDecimals(700)).call()

        const amountIn = expandDecimals(600)

        const { value } = await positionRouter
            .as(user0)
            .multiCall([
                utils.functions.transfer_assets_to_contract(toAsset(USDC), amountIn, toContract(positionRouter)).callParams({
                    forward: [amountIn, getAssetId(USDC)],
                }),
                positionRouter.functions
                    .increase_position(
                        [toAsset(USDC), toAsset(BNB)], // path
                        toAsset(BNB), // index_asset
                        amountIn, // amountIn
                        expandDecimals(1), // minOut
                        toUsd(6000), // size_delta
                        true, // is_long
                        toUsd(310), // acceptablePrice
                        referralCode, // referralCode
                    )
                    .addContracts(attachedContracts),
            ])
            .call()

        // Decrease position
        await expect(
            positionRouter
                .as(user0)
                .functions.decrease_position(
                    [toAsset(BNB), toAsset(USDC)], // path
                    toAsset(BNB), // index_asset
                    toUsd(300), // collateralDelta
                    toUsd(1000), // sizeDelta
                    true, // is_long
                    addrToAccount(user1), // receiver
                    toUsd(290), // acceptablePrice
                    expandDecimals(300), // minOut
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("BPMInvalidAmountOut")
    })

    it("increasePosition acceptablePrice short", async () => {
        await USDC.functions.mint(contrToAccount(vault), expandDecimals(8000)).call()
        await vault.functions.buy_rusd(toAsset(USDC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await router.as(user0).functions.set_approved_plugins(toContract(positionRouterBPM), true).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(2)).call()
        await BNB.functions.mint(addrToAccount(deployer), expandDecimals(2)).call()

        const amountIn = expandDecimals(2)

        await expect(
            positionRouter
                .as(user0)
                .multiCall([
                    utils.functions.transfer_assets_to_contract(toAsset(BNB), amountIn, toContract(positionRouter)).callParams({
                        forward: [amountIn, getAssetId(BNB)],
                    }),
                    positionRouter.functions
                        .increase_position(
                            [toAsset(BNB), toAsset(USDC)], // path
                            toAsset(BNB), // index_asset
                            amountIn, // amountIn
                            expandDecimals(1), // minOut
                            toUsd(6000), // size_delta
                            false, // is_long
                            toUsd(310), // acceptablePrice
                            referralCode, // referralCode
                        )
                        .addContracts(attachedContracts),
                ])
                .call(),
        ).to.be.revertedWith("BPMMarkPriceLtPrice")
    })

    it("maxGlobalShortSize", async () => {
        await USDC.functions.mint(contrToAccount(vault), expandDecimals(8000)).call()
        await vault.functions.buy_rusd(toAsset(USDC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await positionRouterBPM.functions
            .set_max_global_sizes([toAsset(BNB), toAsset(USDC)], [0, 0], [toUsd(5000), toUsd(10000)])
            .addContracts(attachedContracts)
            .call()

        await router.as(user0).functions.set_approved_plugins(toContract(positionRouterBPM), true).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(2)).call()
        await BNB.functions.mint(addrToAccount(deployer), expandDecimals(2)).call()

        const amountIn = expandDecimals(2)

        const tx = positionRouter.as(user0).multiCall([
            utils.functions.transfer_assets_to_contract(toAsset(BNB), amountIn, toContract(positionRouter)).callParams({
                forward: [amountIn, getAssetId(BNB)],
            }),
            positionRouter.functions
                .increase_position(
                    [toAsset(BNB), toAsset(USDC)], // path
                    toAsset(BNB), // index_asset
                    amountIn, // amountIn
                    expandDecimals(1), // minOut
                    toUsd(6000), // size_delta
                    false, // is_long
                    toUsd(290), // acceptablePrice
                    referralCode, // referralCode
                )
                .addContracts(attachedContracts),
        ])
        await expect(tx.call()).to.be.revertedWith("BPMMaxShortsExceeded")

        await positionRouterBPM.functions
            .set_max_global_sizes([toAsset(BNB), toAsset(USDC)], [0, 0], [toUsd(6000), toUsd(10000)])
            .addContracts(attachedContracts)
            .call()

        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BNB)))).eq("0")
        await tx.call()
        expect(await getValStr(vaultUtils.functions.get_global_short_sizes(toAsset(BNB)))).eq(
            "6000000000000000000000000000000000",
        )
    })

    it("decreasePosition acceptablePrice short", async () => {
        await USDC.functions.mint(contrToAccount(vault), expandDecimals(8000)).call()
        await vault.functions.buy_rusd(toAsset(USDC), addrToAccount(user1)).addContracts(attachedContracts).call()

        await router.as(user0).functions.set_approved_plugins(toContract(positionRouterBPM), true).call()

        await BNB.functions.mint(addrToAccount(user0), expandDecimals(2)).call()
        await BNB.functions.mint(addrToAccount(deployer), expandDecimals(2)).call()

        const amountIn = expandDecimals(2)

        await positionRouter
            .as(user0)
            .multiCall([
                utils.functions.transfer_assets_to_contract(toAsset(BNB), amountIn, toContract(positionRouter)).callParams({
                    forward: [amountIn, getAssetId(BNB)],
                }),
                positionRouter.functions
                    .increase_position(
                        [toAsset(BNB), toAsset(USDC)], // path
                        toAsset(BNB), // index_asset
                        amountIn, // amountIn
                        expandDecimals(1), // minOut
                        toUsd(6000), // size_delta
                        false, // is_long
                        toUsd(290), // acceptablePrice
                        referralCode, // referralCode
                    )
                    .addContracts(attachedContracts),
            ])
            .call()

        // Decrease position
        await expect(
            positionRouter
                .as(user0)
                .functions.decrease_position(
                    [toAsset(USDC), toAsset(BNB)], // path
                    toAsset(BNB), // index_asset
                    toUsd(300), // collateralDelta
                    toUsd(1000), // sizeDelta
                    false, // is_long
                    addrToAccount(user1), // receiver
                    toUsd(290), // acceptablePrice
                    0, // minOut
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("BPMMarkPriceGtPrice")
    })

    it("createIncreasePosition, executeIncreasePosition, cancelIncreasePosition", async () => {
        let referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

        const amountIn = expandDecimals(600)

        let params = [
            [toAsset(USDC), toAsset(BNB)], // path
            toAsset(BNB), // index_asset
            amountIn, // amountIn
            expandDecimals(1), // minOut
            toUsd(6000), // size_delta
            true, // is_long
            toUsd(300), // acceptablePrice
        ]

        params[0] = []
        await expect(
            positionRouter
                .as(user0)
                .functions.increase_position(
                    // @ts-ignore
                    ...params,
                    referralCode,
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("PositionRouterInvalidPathLen")

        params[0] = [toAsset(USDC), toAsset(BNB), toAsset(BNB)]
        await expect(
            positionRouter
                .as(user0)
                .functions.increase_position(
                    // @ts-ignore
                    ...params,
                    referralCode,
                )
                .addContracts(attachedContracts)
                .call(),
        ).to.be.revertedWith("PositionRouterInvalidPathLen")

        params[0] = [toAsset(USDC), toAsset(BNB)]

        // the following tests will not yield the correct error because we don't utilize `Router` to
        // `pluginTransfer` assets
        // // await router.functions.set_plugin(toContract(positionRouterBPM), false).call()
        // //
        // // 1:
        //         // await expect(
        // //     positionRouter
        // //         .as(user0)
        // //         .functions.increase_position(
        // //            //@ts-ignore
        // //            ...params,
        // //            minExecutionFee,
        // //            referralCode,
        // //            toContract(ZERO_B256),
        // //        )
        // //        .callParams({
        // //            forward: [minExecutionFee, BASE_ASSET_ID],
        // //        })
        // //        .addContracts(attachedContracts)
        // //        .call(),
        // //).to.be.revertedWith("RouterInvalidPlugin")
        // //
        // // 2:
        //         // await expect(
        // //     positionRouter
        // //         .as(user0)
        // //         .functions.increase_position(
        // //            //@ts-ignore
        // //            ...params,
        // //            minExecutionFee,
        // //            referralCode,
        // //            toContract(ZERO_B256),
        // //        )
        // //        .callParams({
        // //            forward: [minExecutionFee, BASE_ASSET_ID],
        // //        })
        // //        .addContracts(attachedContracts)
        // //        .call(),
        // //).to.be.revertedWith("RouterPluginNotApproved")

        expect(await getValue(referralStorage.functions.get_trader_referral_code(addrToAccount(user0)))).eq(ZERO_B256)
        expect(await getValStr(utils.functions.get_contr_balance(toContract(positionRouter), toAsset(USDC)))).eq("0")

        expect(await getValStr(utils.functions.get_contr_balance(toContract(positionRouter), toAsset(BASE_ASSET_ID)))).eq("0")
        expect(await getValStr(utils.functions.get_contr_balance(toContract(positionRouter), toAsset(BNB)))).eq("0")
        expect(await getValStr(utils.functions.get_contr_balance(toContract(positionRouter), toAsset(USDC)))).eq("0")

        await USDC.functions.mint(addrToAccount(user0), amountIn).call()

        /// the following won't pass because of `VaultPoolAmountExceeded`. PermissionedPositionRouter.test.ts works because only
        /// `create_increase_position` is tested for.
        /// below, both `create_increase_position` and `execute_increase_position` are in the same fn, so will fail
        /// @TODO: these tests aren't yet complete. Complete them

        // await positionRouter
        //     .as(user0)
        //     .multiCall([
        //         utils
        //             .functions.transfer_assets_to_contract(toAsset(USDC), amountIn, toContract(positionRouter))
        //             .callParams({
        //                 forward: [amountIn, getAssetId(USDC)],
        //             }),
        //         positionRouter
        //             .functions.increase_position(
        //                 // @ts-ignore
        //                 ...params,
        //                 referralCode,
        //             )
        //             .addContracts(attachedContracts),
        //     ])
        //     .call()

        // expect((await localProvider.getContractBalance(vault.id, BASE_ASSET_ID)).toString()).eq(minExecutionFee)
        // expect(await getValStr(utils.functions.get_contr_balance(toContract(positionRouter), toAsset(USDC)))).eq(
        //     expandDecimals(600),
        // )
    })

    it("custom tests - increase + decrease", async () => {
        await BNB.functions.mint(contrToAccount(vault), expandDecimals(30)).call()
        await vault.functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        await router.as(user0).functions.set_approved_plugins(toContract(positionRouterBPM), true).call()

        await USDC.functions.mint(addrToAccount(user0), expandDecimals(700)).call()
        await USDC.functions.mint(addrToAccount(deployer), expandDecimals(700)).call()

        let referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"
        const amountIn = expandDecimals(600)

        console.log(
            "[increase_position] USDC balance before :",
            (await localProvider.getBalance(user0.address, toAsset(USDC).bits)).toString(),
        )
        console.log(
            "[increase_position] BNB balance before  :",
            (await localProvider.getBalance(user0.address, toAsset(BNB).bits)).toString(),
        )
        await positionRouter
            .as(user0)
            .multiCall([
                utils.functions.transfer_assets_to_contract(toAsset(USDC), amountIn, toContract(positionRouter)).callParams({
                    forward: [amountIn, getAssetId(USDC)],
                }),
                positionRouter.functions
                    .increase_position(
                        [toAsset(USDC), toAsset(BNB)], // path
                        toAsset(BNB), // index_asset
                        amountIn, // amountIn
                        expandDecimals(1), // minOut
                        toUsd(6000), // size_delta
                        true, // is_long
                        toUsd(300), // acceptablePrice
                        referralCode, // referralCode
                    )
                    .addContracts(attachedContracts),
            ])
            .call()
        console.log(
            "\n--------------------------------\n",
            "[increase_position] USDC balance middle :",
            (await localProvider.getBalance(user0.address, toAsset(USDC).bits)).toString(),
        )
        console.log(
            "[increase_position] BNB balance middle  :",
            (await localProvider.getBalance(user0.address, toAsset(BNB).bits)).toString(),
            "\n--------------------------------\n",
        )

        await router.as(user0).functions.set_approved_plugins(toContract(positionRouterBPM), true).call()

        // remove the entire F*CKING position
        // make sure: collateralDelta is equal to the collateral in the position used for increasing!!!
        const { logs } = await positionRouter
            .as(user0)
            .functions.decrease_position(
                [toAsset(BNB)], // path
                toAsset(BNB), // index_asset
                toUsd(5910), // collateralDelta
                toUsd(6000), // sizeDelta
                true, // is_long
                addrToAccount(user0), // receiver
                toUsd(290), // acceptablePrice
                0, // minOut
            )
            .addContracts(attachedContracts)
            .call()
        console.log(
            "[decrease_position] USDC balance after :",
            (await localProvider.getBalance(user0.address, toAsset(USDC).bits)).toString(),
        )
        console.log(
            "[decrease_position] BNB balance after  :",
            (await localProvider.getBalance(user0.address, toAsset(BNB).bits)).toString(),
            "\n\n",
        )

        console.log("BNB:", toAsset(BNB))
        console.log("USDC:", toAsset(USDC))

        console.log("Logs", formatObj(logs))
    })
})
