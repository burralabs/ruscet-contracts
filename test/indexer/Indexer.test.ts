import { expect, use } from "chai"
import { AbstractContract, BN, FUEL_NETWORK_URL, Provider, Wallet, WalletUnlocked, getMintedAssetId } from "fuels"
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
import { deploy, formatObj, getValStr, getValue, indexerDeploy } from "../utils/utils"
import { addrToAccount, contrToAccount, toAddress, toContract } from "../utils/account"
import { expandDecimals, toPrice, toUsd } from "../utils/units"
import { ZERO_B256 } from "../utils/constants"
import { getAssetId, toAsset, transfer } from "../utils/asset"
import { useChai } from "../utils/chai"
import { WALLETS } from "../utils/wallets"
import { getDaiConfig, getEthConfig } from "../utils/vault"
import { BASE_ASSET_ID, minExecutionFee } from "../../deployment/utils"
import { log } from "console"
import path from "path"
import fs from "fs"

use(useChai)

async function outOfGasCall(tx: any) {
    const { gasUsed } = await tx.getTransactionCost()
    const gasLimit = gasUsed.mul("6").div("5").toString()
    return tx.txParams({ gasLimit }).call()
}

describe("Indexer", () => {
    const depositFee = "50"
    const referralCode = ZERO_B256
    let FORCE_DEPLOY = false

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
    let shortsTracker: ShortsTrackerAbi
    let positionRouter: PositionRouterAbi
    let positionRouterBPM: BasePositionManagerAbi
    let referralStorage: ReferralStorageAbi

    it("deploy/load", async () => {
        localProvider = await Provider.create(FUEL_NETWORK_URL)

        const wallets = WALLETS.map((k) => Wallet.fromPrivateKey(k, localProvider))

        ;[deployer, user0, user1, user2, user3] = wallets

        /*
            NativeAsset + Pricefeed
        */
        USDC = (await indexerDeploy("Fungible", deployer, "USDCFungible", FORCE_DEPLOY)) as FungibleAbi
        USDCPricefeed = (await indexerDeploy("Pricefeed", deployer, "USDCPricefeed", FORCE_DEPLOY)) as PricefeedAbi

        DAI = (await deploy("Fungible", deployer)) as FungibleAbi
        DAIPricefeed = (await deploy("Pricefeed", deployer)) as PricefeedAbi

        BNB = (await indexerDeploy("Fungible", deployer, "BNBFungible", FORCE_DEPLOY)) as FungibleAbi
        BNBPricefeed = (await indexerDeploy("Pricefeed", deployer, "BNBPricefeed", FORCE_DEPLOY)) as PricefeedAbi

        /*
            Vault + Router + RUSD
        */
        utils = await indexerDeploy("Utils", deployer, undefined, FORCE_DEPLOY)
        vault = await indexerDeploy("Vault", deployer, undefined, FORCE_DEPLOY)
        vaultStorage = await indexerDeploy("VaultStorage", deployer, undefined, FORCE_DEPLOY)
        vaultUtils = await indexerDeploy("VaultUtils", deployer, undefined, FORCE_DEPLOY)
        vaultPricefeed = await indexerDeploy("VaultPricefeed", deployer, undefined, FORCE_DEPLOY)
        rusd = await indexerDeploy("Rusd", deployer, undefined, FORCE_DEPLOY)
        router = await indexerDeploy("Router", deployer, undefined, FORCE_DEPLOY)
        shortsTracker = await indexerDeploy("ShortsTracker", deployer, undefined, FORCE_DEPLOY)
        positionRouterBPM = await indexerDeploy("BasePositionManager", deployer, "PositionRouterBPM", FORCE_DEPLOY)
        positionRouter = await indexerDeploy("PositionRouter", deployer, undefined, FORCE_DEPLOY)
        referralStorage = await indexerDeploy("ReferralStorage", deployer, undefined, FORCE_DEPLOY)

        attachedContracts = [
            vault,
            vaultStorage,
            vaultUtils,
            vaultPricefeed,
            positionRouterBPM,
            shortsTracker,
            router,
            rusd,
            referralStorage,
        ]

        RUSD = getAssetId(rusd)

        if (FORCE_DEPLOY) {
            await USDCPricefeed.functions.initialize(addrToAccount(deployer), "USDC Pricefeed").call()
            await DAIPricefeed.functions.initialize(addrToAccount(deployer), "DAI Pricefeed").call()
            await BNBPricefeed.functions.initialize(addrToAccount(deployer), "BNB Pricefeed").call()

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

            await vaultPricefeed.functions.initialize(addrToAccount(deployer)).call()
            await vaultPricefeed.functions.set_asset_config(toAsset(USDC), toContract(USDCPricefeed), 8, false).call()
            await vaultPricefeed.functions.set_asset_config(toAsset(DAI), toContract(DAIPricefeed), 8, false).call()
            await vaultPricefeed.functions.set_asset_config(toAsset(BNB), toContract(BNBPricefeed), 8, false).call()

            await vaultStorage.functions.set_asset_config(...getDaiConfig(USDC)).call()
            await vaultStorage.functions.set_asset_config(...getEthConfig(BNB)).call()

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
        }
    })

    it("populate config.yaml addresses", async () => {
        const deployments = require("./indexer_deployments.json")
        const config_yaml_template_file = path.resolve(__dirname, "../../../../ruscet-indexer/templates/config.template.yaml")
        const config_yaml_file = path.resolve(__dirname, "../../../../ruscet-indexer/config.local.yaml")

        const config_yaml_template_contents = fs.readFileSync(config_yaml_template_file).toString()
        const config_yaml_contents = config_yaml_template_contents
            .replace("POSITION_ROUTER_ADDR", deployments.PositionRouter)
            .replace("VAULT_ADDR", deployments.Vault)
            .replace("VAULT_UTILS_ADDR", deployments.VaultUtils)
            .replace("VAULT_STORAGE_ADDR", deployments.VaultStorage)
            .replace("POSITION_ROUTER_BPM_ADDR", deployments.PositionRouterBPM)
            .replace("RLP_MANAGER_ADDR", deployments.RlpManager)
            .replace("RLP_MANAGER_ADDR", deployments.RlpManager)
            .replace("REFERRAL_STORAGE_ADDR", deployments.ReferralStorage)
            .replace("ORDERBOOK_ADDR", deployments.Orderbook)
            .replace("SHORTS_TRACKER_ADDR", deployments.ShortsTracker)

        deployments["USDC"] = getMintedAssetId(deployments.USDCFungible, ZERO_B256)
        deployments["BNB"] = getMintedAssetId(deployments.BNBFungible, ZERO_B256)

        fs.writeFileSync(path.resolve(__dirname, "./indexer_deployments.json"), JSON.stringify(deployments, null, 4))
        fs.writeFileSync(config_yaml_file, config_yaml_contents)
    })

    it("PositionRouter: withdrawFees", async () => {
        await BNB.functions.mint(contrToAccount(vault), expandDecimals(30)).call()
        await vault.functions.buy_rusd(toAsset(BNB), addrToAccount(user1)).addContracts(attachedContracts).call()

        await router.as(user0).functions.set_approved_plugins(toContract(positionRouterBPM), true).call()

        await USDC.functions.mint(addrToAccount(user0), expandDecimals(700)).call()
        await USDC.functions.mint(addrToAccount(deployer), expandDecimals(700)).call()

        const amountIn = expandDecimals(600)

        const { value } = await outOfGasCall(
            positionRouter.as(user0).multiCall([
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
            ]),
        )

        // ---------------------------------

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

        await positionRouterBPM.functions.withdraw_fees(toAsset(USDC), addrToAccount(user3)).call()

        // await positionRouterBPM.functions.withdraw_fees(toAsset(BNB), addrToAccount(user3)).call()
    })
})
