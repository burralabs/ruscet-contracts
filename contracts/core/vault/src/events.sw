// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::Account,
    signed_256::*
};

pub struct SetGov {
    pub new_gov: Account
}

pub struct RegisterPositionByKey {
    pub position_key: b256,
    pub account: Account,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub is_long: bool
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

pub struct IncreasePosition {
    pub key: b256,
    pub account: Account,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub collateral_delta: u256,
    pub size_delta: u256,
    pub is_long: bool,
    pub price: u256,
    pub fee: u256,
}

pub struct UpdatePosition {
    pub key: b256,
    pub size: u256,
    pub collateral: u256,
    pub average_price: u256,
    pub entry_funding_rate: u256,
    pub reserve_amount: u256,
    pub realized_pnl: Signed256,
    pub mark_price: u256,
}

pub struct LiquidatePosition {
    pub key: b256,
    pub account: Account,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub is_long: bool,
    pub size: u256,
    pub collateral: u256,
    pub reserve_amount: u256,
    pub realized_pnl: Signed256,
    pub mark_price: u256,
}

pub struct DecreasePosition {
    pub key: b256,
    pub account: Account,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub collateral_delta: u256,
    pub size_delta: u256,
    pub is_long: bool,
    pub price: u256,
    pub fee: u256,
}

pub struct ClosePosition {
    pub key: b256,
    pub size: u256,
    pub collateral: u256,
    pub average_price: u256,
    pub entry_funding_rate: u256,
    pub reserve_amount: u256,
    pub realized_pnl: Signed256,
}

pub struct UpdatePnl {
    pub key: b256,
    pub has_profit: bool,
    pub delta: u256,
}

pub struct CollectMarginFees {
    pub asset: AssetId,
    pub fee_usd: u256,
    pub fee_assets: u256,
}

pub struct WithdrawFees {
    pub asset: AssetId,
    pub receiver: Account,
    pub amount: u256
}