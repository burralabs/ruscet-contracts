// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::Account,
    signed_256::*
};

pub struct SetGov {
    pub gov: Account
}

pub struct SetVaultRouter {
    pub vault_router: ContractId
}   

pub struct SetVaultStorage {
    pub vault_storage: ContractId
}

pub struct SetVaultUtils {
    pub vault_utils: ContractId
}

pub struct SetVault {
    pub vault: ContractId
}

pub struct BuyRUSD {
    pub account: Account,
    pub asset: AssetId,
    pub asset_amount: u64,
    pub rusd_amount: u256,
    pub fee_basis_points: u256,
}

pub struct SellRUSD {
    pub account: Account,
    pub asset: AssetId,
    pub asset_amount: u64,
    pub rusd_amount: u256,
    pub fee_basis_points: u256,
}

pub struct CollectSwapFees {
    pub asset: AssetId,
    pub fee_usd: u256,
    pub fee_assets: u64,
}

pub struct DirectPoolDeposit {
    pub asset: AssetId,
    pub amount: u256,
}

pub struct Swap {
    pub account: Account,
    pub asset_in: AssetId,
    pub asset_out: AssetId,
    pub amount_in: u256,
    pub amount_out: u256,
    pub amount_out_after_fees: u256,
    pub fee_basis_points: u256,
}

pub struct WithdrawFees {
    pub asset: AssetId,
    pub receiver: Account,
    pub amount: u256
}