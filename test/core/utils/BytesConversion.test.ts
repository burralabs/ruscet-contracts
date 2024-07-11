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
    arrayify,
} from "fuels"
import { BytesConversionAbi } from "../../../types"
import { deploy } from "../../utils/utils"
import { useChai } from "../../utils/chai"
import { WALLETS } from "../../utils/wallets"
import { toPrice } from "../../utils/units"
import { EncodeMockPriceDataAbi__factory, DecodeMockPriceDataAbi__factory } from "../../../types/scripts"

use(useChai)

describe("Utils.bytesConversion", () => {
    let deployer: WalletUnlocked
    let user0: WalletUnlocked
    let user1: WalletUnlocked
    let user2: WalletUnlocked
    let user3: WalletUnlocked
    let bytesConversion: BytesConversionAbi

    beforeEach(async () => {
        const localProvider = await Provider.create(FUEL_NETWORK_URL)

        const wallets = WALLETS.map((k) => Wallet.fromPrivateKey(k, localProvider))

        ;[deployer, user0, user1, user2, user3] = wallets

        bytesConversion = await deploy("BytesConversion", deployer)
    })

    it("b256 <-> Bytes", async () => {
        const B256_VALUE = "0xe373620c9fdae7e928ee42001314bf8ab9638cd82a61f4e19a4e27133a419f7b"
        const BYTES_VALUE = "7b9f413a13274e9ae1f4612ad88c63b98abf14130042ee28e9e7da9f0c6273e3"

        const _bytes = (await bytesConversion.functions.b256_to_bytes(B256_VALUE).get()).value
        const bytes = hexlify(Buffer.from(_bytes as any))

        expect(bytes).to.equal("0x" + BYTES_VALUE)

        const b256_value = (await bytesConversion.functions.bytes_to_b256(arrayify(Buffer.from(BYTES_VALUE, "hex"))).get()).value

        expect(b256_value).to.equal(B256_VALUE)
    })

    it("u256 <-> Bytes", async () => {
        const U256_VALUE = toPrice(69420)
        const BYTES_VALUE = "00ac714f50060000000000000000000000000000000000000000000000000000"

        const _bytes = (await bytesConversion.functions.u256_to_bytes(U256_VALUE).get()).value
        const bytes = hexlify(Buffer.from(_bytes as any))

        expect(bytes).to.equal("0x" + BYTES_VALUE)

        const u256_value = (
            await bytesConversion.functions.bytes_to_u256(arrayify(Buffer.from(BYTES_VALUE, "hex"))).get()
        ).value.toString()

        expect(u256_value).to.equal(U256_VALUE)
    })

    it("u64 <-> Bytes", async () => {
        const U64_VALUE = "69420"
        const BYTES_VALUE = "2c0f010000000000"

        const _bytes = (await bytesConversion.functions.u64_to_bytes(U64_VALUE).get()).value
        const bytes = hexlify(Buffer.from(_bytes as any))

        expect(bytes).to.equal("0x" + BYTES_VALUE)

        const u64_value = (
            await bytesConversion.functions.bytes_to_u64(arrayify(Buffer.from(BYTES_VALUE, "hex"))).get()
        ).value.toString()

        expect(u64_value).to.equal(U64_VALUE)
    })

    it("SCRIPT: encode_mock_price_data", async () => {
        const PRICE_U64 = toPrice(69420)
        const PRICEFEED_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"

        const encodeMockPriceDataScript = EncodeMockPriceDataAbi__factory.createInstance(deployer)
        const decodeMockPriceDataScript = DecodeMockPriceDataAbi__factory.createInstance(deployer)

        const encodedPriceData = (await encodeMockPriceDataScript.functions.main(PRICEFEED_ID, PRICE_U64).call()).value
        const decodedPriceData = (await decodeMockPriceDataScript.functions.main(encodedPriceData).get()).value

        expect(decodedPriceData[0]).to.equal(PRICEFEED_ID)
        expect(decodedPriceData[1].toString()).to.equal(PRICE_U64)
    })
})
