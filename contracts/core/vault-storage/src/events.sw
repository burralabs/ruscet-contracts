// SPDX-License-pub Identifier: Apache-2.0
library;

use helpers::{
    context::Account,
    signed_256::*
};
use core_interfaces::vault_storage::Position;

pub struct SetAssetConfig {
    pub asset: AssetId,
    pub asset_decimals: u8,
    pub asset_weight: u64,
    pub min_profit_bps: u64,
    pub max_rusd_amount: u256,
    pub is_stable: bool,
    pub is_shortable: bool
}

pub struct ClearAssetConfig {
    pub asset: AssetId,
}

pub struct SetFundingRateInfo {
    pub funding_interval: u64,
    pub funding_rate_factor: u64,
    pub stable_funding_rate_factor: u64
}

pub struct SetFees {
    pub tax_basis_points: u64,
    pub stable_tax_basis_points: u64,
    pub mint_burn_fee_basis_points: u64,
    pub swap_fee_basis_points: u64,
    pub stable_swap_fee_basis_points: u64,
    pub margin_fee_basis_points: u64,
    pub liquidation_fee_usd: u256,
    pub min_profit_time: u64,
    pub has_dynamic_fees: bool
}

pub struct WriteAssetBalance {
    pub asset: AssetId,
    pub balance: u64,
}

pub struct WriteMaxRusdAmount {
    pub asset: AssetId,
    pub max_rusd_amount: u256,
}

pub struct WriteBufferAmount {
    pub asset: AssetId,
    pub buffer_amount: u256,
}

pub struct WriteLastFundingTime {
    pub asset: AssetId,
    pub last_funding_time: u64,
}

pub struct WritePosition {
    pub position_key: b256,
    pub position: Position
}

pub struct WriteFeeReserve {
    pub asset: AssetId,
    pub fee_reserve: u256,
}

pub struct WriteGlobalShortAveragePrice {
    pub asset: AssetId,
    pub global_short_average_price: u256,
}

pub struct SetMaxGlobalShortSize {
    pub asset: AssetId,
    pub max_global_short_size: u256,
}