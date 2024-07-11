// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    fixed_vec::FixedVecAssetIdSize5
};

pub struct PositionRouterIncreasePosition {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub amount_in: u64,
    pub min_out: u64,
    pub size_delta: u256,
    pub is_long: bool,
    pub acceptable_price: u256,
    pub block_height: u32,
    pub timestamp: u64
}

pub struct PositionRouterDecreasePosition {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub collateral_delta: u256,
    pub size_delta: u256,
    pub is_long: bool,
    pub receiver: Account,
    pub acceptable_price: u256,
    pub min_out: u64,
    pub block_height: u32,
    pub timestamp: u64
}

pub struct SetIsLeverageEnabled {
    pub is_leverage_enabled: bool
}