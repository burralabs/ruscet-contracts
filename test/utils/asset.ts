import { getMintedAssetId } from "fuels"
import { FungibleAbi } from "../../types"
import { Account } from "./types"

export function toAsset(value: any) {
    return { bits: getAssetId(value) }
}

export function getAssetId(
    fungibleContract: any,
    sub_id: string = "0x0000000000000000000000000000000000000000000000000000000000000000",
): string {
    const id = typeof fungibleContract === "string" ? fungibleContract : fungibleContract.id.toHexString()
    return getMintedAssetId(id, sub_id)
}

export async function transfer(fungibleContract: FungibleAbi, to: Account, amount: number | string) {
    const call = fungibleContract.functions
        .transfer(to, amount)
        .callParams({
            forward: [amount, getAssetId(fungibleContract)],
            // gasLimit: 1000000,
        })
        .txParams({
            gasLimit: 1000000,
        })

    await call.call()
}
