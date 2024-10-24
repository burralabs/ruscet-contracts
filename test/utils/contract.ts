import { BN, BigNumberCoder, BooleanCoder, StructCoder, hexlify, keccak256, toB256 } from "fuels"
import { VaultStorage, VaultUtils } from "../../types"
import { getValue } from "./utils"
import { Account, AssetId } from "./types"

/*
pub struct PositionKey {
    pub account: Account,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub is_long: bool,
}
*/
const PositionKeyStructEncoder = new StructCoder("Key", {
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

export async function getPositionLeverage(
    vaultStorage: VaultStorage,
    account: { value: string; is_contract: boolean },
    collateral_asset: { bits: string },
    index_asset: { bits: string },
    is_long: boolean,
) {
    const positionKeyStruct = { account, collateral_asset, index_asset, is_long }
    const positionKey = hexlify(keccak256(PositionKeyStructEncoder.encode(positionKeyStruct)))

    const position = await getValue(vaultStorage.functions.get_position_by_key(positionKey))

    if (position.collateral.toString() === "0") {
        throw new Error("VaultRouterInvalidPositionSize")
    }

    const positionLeverage = new BN(position.size).mul(10000).div(position.collateral)

    return positionLeverage.toString()
}

export async function getPosition(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    is_long: boolean,
    vaultStorage: VaultStorage,
) {
    const positionKeyStruct = { account, collateral_asset, index_asset, is_long }
    const positionKey = hexlify(keccak256(PositionKeyStructEncoder.encode(positionKeyStruct)))

    return await getValue(vaultStorage.functions.get_position_by_key(positionKey))
}
