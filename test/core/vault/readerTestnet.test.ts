import { use } from "chai"
import { Provider, Wallet, WalletUnlocked } from "fuels"
import {
    PositionManagerAbi,
    PositionManagerAbi__factory,
    PositionRouterAbi,
    PositionRouterAbi__factory,
    ReaderAbi,
    ReaderAbi__factory,
    RouterAbi,
    RouterAbi__factory,
    VaultAbi,
    VaultAbi__factory,
    VaultPricefeedAbi,
    VaultPricefeedAbi__factory,
    VaultReaderAbi,
    VaultReaderAbi__factory,
    VaultStorageAbi,
    VaultStorageAbi__factory,
    VaultUtilsAbi,
    VaultUtilsAbi__factory,
} from "../../../types"
import { useChai } from "../../utils/chai"
import { WALLETS } from "../../utils/wallets"
import deployments from "../../../../src/constants/deployments.json"

use(useChai)

describe("Vault.readTestnet", () => {
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let vault: VaultAbi
    let vaultStorage: VaultStorageAbi
    let vaultUtils: VaultUtilsAbi
    let reader: ReaderAbi
    let router: RouterAbi
    let vaultReader: VaultReaderAbi
    let vaultPricefeed: VaultPricefeedAbi
    let positionRouter: PositionRouterAbi
    let positionManager: PositionManagerAbi

    beforeEach(async () => {
        // const testnetProvider = await Provider.create(FUEL_NETWORK_URL)
        const testnetProvider = await Provider.create("https://testnet.fuel.network/v1/graphql")

        const wallets = WALLETS.map((k) => Wallet.fromPrivateKey(k, testnetProvider))

        ;[deployer, user0, user1, user2, user3] = wallets

        vault = VaultAbi__factory.connect(deployments.testnet.vault.Vault, deployer)
        vaultStorage = VaultStorageAbi__factory.connect(deployments.testnet.vault.VaultStorage, deployer)
        vaultUtils = VaultUtilsAbi__factory.connect(deployments.testnet.vault.VaultUtils, deployer)
        reader = ReaderAbi__factory.connect(deployments.testnet.peripherals.Reader, deployer)
        vaultReader = VaultReaderAbi__factory.connect(deployments.testnet.peripherals.VaultReader, deployer)
        vaultPricefeed = VaultPricefeedAbi__factory.connect(deployments.testnet.vault.VaultPricefeed, deployer)
        router = RouterAbi__factory.connect(deployments.testnet.misc.Router, deployer)
        positionRouter = PositionRouterAbi__factory.connect(deployments.testnet.peripherals.PositionRouter, deployer)
        positionManager = PositionManagerAbi__factory.connect(deployments.testnet.peripherals.PositionManager, deployer)
    })

    it("read-testnet", async () => {
        // console.log("Position router:", await positionRouter.functions.get_base_position_manager)
        // console.log(
        //     "Vault asset info:",
        //     (
        //         await vaultReader.functions
        //             .get_vault_asset_info_v4(toContract(vault), toContract(positionRouter), expandDecimals(1, 18), [
        //                 toContract(deployments.testnet.assets.ETH),
        //                 toContract(deployments.testnet.assets.BTC),
        //             ])
        //             .get()
        //     ).value,
        // )
        // console.log(
        //     "Vault pricefeed info:",
        //     (
        //         await vaultPricefeed.functions.get_primary_price(toContract(deployments.testnet.assets.ETH), false).get()
        //     ).value.toString(),
        // )
    })
})
