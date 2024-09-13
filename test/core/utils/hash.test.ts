import { expect, use } from "chai"
import { BigNumberCoder, BooleanCoder, Provider, StructCoder, Wallet, WalletUnlocked, hexlify, keccak256, sha256 } from "fuels"
import { Hash } from "../../../types"
import { deploy } from "../../utils/utils"
import { useChai } from "../../utils/chai"
import { WALLETS } from "../../utils/wallets"

use(useChai)

describe("Hash", () => {
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let hash: Hash

    beforeEach(async () => {
        const FUEL_NETWORK_URL = "http://127.0.0.1:4000/v1/graphql"
        const localProvider = await Provider.create(FUEL_NETWORK_URL)

        const wallets = WALLETS.map((k) => Wallet.fromPrivateKey(k, localProvider))
        ;[deployer, user0, user1, user2, user3] = wallets

        hash = await deploy("Hash", deployer)
    })

    it("hash_keccak256", async () => {
        const hashValue = (await hash.functions.hash_key_keccak256(69, 420, true).get()).value.toString()

        const myStruct = {
            one: 69,
            two: 420,
            three: true,
        }

        const structCoder = new StructCoder("Key", {
            one: new BigNumberCoder("u256"),
            two: new BigNumberCoder("u64"),
            three: new BooleanCoder(),
        })
        const encodedStruct: Uint8Array = structCoder.encode(myStruct)
        const hashedStruct = hexlify(keccak256(encodedStruct))

        expect(hashedStruct === hashValue).to.be.true
    })

    it("hash_sha256", async () => {
        const hashValue = (await hash.functions.hash_key_sha256(69, 420, true).get()).value.toString()

        const myStruct = {
            one: 69,
            two: 420,
            three: true,
        }

        const structCoder = new StructCoder("Key", {
            one: new BigNumberCoder("u256"),
            two: new BigNumberCoder("u64"),
            three: new BooleanCoder(),
        })
        const encodedStruct: Uint8Array = structCoder.encode(myStruct)
        const hashedStruct = hexlify(sha256(encodedStruct))

        expect(hashedStruct === hashValue).to.be.true
    })
})
