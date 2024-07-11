import { expect, use } from "chai"
import {
    BigNumberCoder,
    BooleanCoder,
    FUEL_NETWORK_URL,
    Provider,
    StructCoder,
    Wallet,
    WalletUnlocked,
    hexlify,
    keccak256,
    sha256,
} from "fuels"
import { HashAbi, VaultAbi } from "../../../types"
import { deploy } from "../../utils/utils"
import { useChai } from "../../utils/chai"
import { WALLETS } from "../../utils/wallets"
import { addrToAccount } from "../../utils/account"
import { ZERO_B256 } from "../../utils/constants"

use(useChai)

describe("Vault.positionKeyHash", () => {
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let hash: HashAbi
    let vault: VaultAbi

    beforeEach(async () => {
        const localProvider = await Provider.create(FUEL_NETWORK_URL)

        const wallets = WALLETS.map((k) => Wallet.fromPrivateKey(k, localProvider))

        ;[deployer, user0, user1, user2, user3] = wallets

        hash = await deploy("Hash", deployer)
        vault = await deploy("Vault", deployer)
    })

    it("struct 1", async () => {
        const positionKeyStruct = {
            account: { value: ZERO_B256, is_contract: false },
            collateral_asset: { bits: ZERO_B256 },
            index_asset: { bits: ZERO_B256 },
            is_long: true,
        }

        const hashValue = (
            await vault.functions
                .get_position_key(
                    positionKeyStruct.account,
                    positionKeyStruct.collateral_asset,
                    positionKeyStruct.index_asset,
                    positionKeyStruct.is_long,
                )
                .get()
        ).value

        const structCoder = new StructCoder("Key", {
            account: new StructCoder("Account", {
                value: new BigNumberCoder("u256"),
                is_contract: new BooleanCoder(),
            }),
            collateral_asset: new StructCoder("Collateral Asset", {
                bits: new BigNumberCoder("u256"),
            }),
            index_asset: new StructCoder("Index Asset", {
                bits: new BigNumberCoder("u256"),
            }),
            is_long: new BooleanCoder(),
        })
        const hashedStruct = hexlify(keccak256(structCoder.encode(positionKeyStruct)))

        expect(hashedStruct === hashValue).to.be.true
    })

    it("struct 2", async () => {
        const positionKeyStruct = {
            account: {
                value: "0x94f066138CF5a669c28f83a6Cf572B75B8466C1494f066138CF5a669c1c33112",
                is_contract: true,
            },
            collateral_asset: { bits: "0x04D1E7591F00aBee4819E3953C2B92acef0ac98b04D1E7591F00aBee4819E395" },
            index_asset: { bits: "0x78420A47d94C3F77afFDBe1F681B48e44e18afa678420A47d94C3F77afFDBe1F" },
            is_long: false,
        }

        const hashValue = (
            await vault.functions
                .get_position_key(
                    positionKeyStruct.account,
                    positionKeyStruct.collateral_asset,
                    positionKeyStruct.index_asset,
                    positionKeyStruct.is_long,
                )
                .get()
        ).value

        const structCoder = new StructCoder("Key", {
            account: new StructCoder("Account", {
                value: new BigNumberCoder("u256"),
                is_contract: new BooleanCoder(),
            }),
            collateral_asset: new StructCoder("Collateral Asset", {
                bits: new BigNumberCoder("u256"),
            }),
            index_asset: new StructCoder("Index Asset", {
                bits: new BigNumberCoder("u256"),
            }),
            is_long: new BooleanCoder(),
        })
        const hashedStruct = hexlify(keccak256(structCoder.encode(positionKeyStruct)))

        expect(hashedStruct === hashValue).to.be.true
    })
})
