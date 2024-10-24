import { BigNumber } from "ethers"
import { Fungible, VaultRouter, Vault, VaultStorage, VaultUtils } from "../../types"
import { toContract } from "./account"
import { toAsset } from "./asset"

export async function validateVaultRouterBalance(
    expect: any,
    vault: Vault,
    vaultStorage: VaultStorage,
    vaultUtils: VaultUtils,
    token: Fungible,
    offset: number | string = 0,
) {
    const poolAmount = (await vaultUtils.functions.get_pool_amounts(toAsset(token)).get()).value
    const feeReserve = (await vaultStorage.functions.get_fee_reserves(toAsset(token)).get()).value
    const balance = (await token.functions.get_balance(toContract(vault)).get()).value.toString()
    let amount = poolAmount.add(feeReserve)
    // console.log("Balance:", balance)
    expect(BigNumber.from(balance).gt(0)).to.be.true
    expect(poolAmount.add(feeReserve).add(offset).toString()).eq(balance)
}

export const USDC_MAX_LEVERAGE = 0 // 50 * 10_000
export const DAI_MAX_LEVERAGE = 0 // 50 * 10_000
export const BTC_MAX_LEVERAGE = 50 * 10_000
export const ETH_MAX_LEVERAGE = 50 * 10_000
export const BNB_MAX_LEVERAGE = 50 * 10_000

// https://cumsum.wordpress.com/2021/08/28/typescript-a-spread-argument-must-either-have-a-tuple-type-or-be-passed-to-a-rest-parameter/
export function getDaiConfig(fungible: Fungible): [{ bits: string }, number, number, number, number, boolean, boolean] {
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

export function getBtcConfig(fungible: Fungible): [{ bits: string }, number, number, number, number, boolean, boolean] {
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

export function getEthConfig(fungible: Fungible): [{ bits: string }, number, number, number, number, boolean, boolean] {
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

export function getBnbConfig(fungible: Fungible): [{ bits: string }, number, number, number, number | string, boolean, boolean] {
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
