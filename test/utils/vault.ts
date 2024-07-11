import { BigNumber } from "ethers"
import { FungibleAbi, VaultAbi, VaultStorageAbi, VaultStorageAbi__factory, VaultUtilsAbi } from "../../types"
import { toContract } from "./account"
import { getAssetId, toAsset } from "./asset"
import { formatObj, getBalance } from "./utils"
import { FUEL_NETWORK_URL, Provider } from "fuels"

export async function validateVaultBalance(
    expect: any,
    vault: VaultAbi,
    vaultStorage: VaultStorageAbi,
    vaultUtils: VaultUtilsAbi,
    token: FungibleAbi,
    offset: number | string = 0,
) {
    const poolAmount = (await vaultUtils.functions.get_pool_amounts(toAsset(token)).call()).value
    const feeReserve = (await vaultStorage.functions.get_fee_reserves(toAsset(token)).call()).value
    const balance = (await token.functions.get_balance(toContract(vault)).call()).value.toString()
    let amount = poolAmount.add(feeReserve)
    // console.log("Balance:", balance)
    expect(BigNumber.from(balance).gt(0)).to.be.true
    expect(poolAmount.add(feeReserve).add(offset).toString()).eq(balance)
}

// https://cumsum.wordpress.com/2021/08/28/typescript-a-spread-argument-must-either-have-a-tuple-type-or-be-passed-to-a-rest-parameter/
export function getDaiConfig9Decimals(
    fungible: FungibleAbi,
): [{ bits: string }, number, number, number, number, boolean, boolean] {
    return [
        toAsset(fungible), // asset
        9, // asset_decimals
        10000, // asset_weight
        75, // min_profit_bps
        0, // max_rusd_amount
        true, // is_stable
        false, // is_shortable
    ]
}

export function getBtcConfig9Decimals(
    fungible: FungibleAbi,
): [{ bits: string }, number, number, number, number, boolean, boolean] {
    return [
        toAsset(fungible), // asset
        9, // asset_decimals
        10000, // asset_weight
        75, // min_profit_bps
        0, // max_rusd_amount
        false, // is_stable
        true, // is_shortable
    ]
}

// https://cumsum.wordpress.com/2021/08/28/typescript-a-spread-argument-must-either-have-a-tuple-type-or-be-passed-to-a-rest-parameter/
export function getDaiConfig(fungible: FungibleAbi): [{ bits: string }, number, number, number, number, boolean, boolean] {
    return [
        toAsset(fungible), // asset
        8, // asset_decimals
        10000, // asset_weight
        75, // min_profit_bps
        0, // max_rusd_amount
        true, // is_stable
        false, // is_shortable
    ]
}

export function getBtcConfig(fungible: FungibleAbi): [{ bits: string }, number, number, number, number, boolean, boolean] {
    return [
        toAsset(fungible), // asset
        8, // asset_decimals
        10000, // asset_weight
        75, // min_profit_bps
        0, // max_rusd_amount
        false, // is_stable
        true, // is_shortable
    ]
}

export function getEthConfig(fungible: FungibleAbi): [{ bits: string }, number, number, number, number, boolean, boolean] {
    return [
        toAsset(fungible), // asset
        8, // asset_decimals (@TODO: actually: 18)
        10000, // asset_weight
        75, // min_profit_bps
        0, // max_rusd_amount
        false, // is_stable
        true, // is_shortable
    ]
}

export function getBnbConfig(
    fungible: FungibleAbi,
): [{ bits: string }, number, number, number, number | string, boolean, boolean] {
    return [
        toAsset(fungible), // asset
        8, // asset_decimals (@TODO: actually: 18)
        10000, // asset_weight
        75, // min_profit_bps
        0, // max_rusd_amount
        false, // is_stable
        true, // is_shortable
    ]
}
