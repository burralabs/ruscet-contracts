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

pub struct SetVault {
    pub vault: ContractId
}

pub struct WriteAuthorize {
    pub account: Account,
    pub is_authorized: bool,
}

pub struct SetFundingRateInfo {
    pub funding_interval: u64,
    pub funding_rate_factor: u64,
    pub stable_funding_rate_factor: u64
}

pub struct SetMaxLeverage {
    pub asset: AssetId,
    pub max_leverage: u256,
}

pub struct UpdateFundingRate {
    pub asset: AssetId,
    pub funding_rate: u256,
}

pub struct UpdateGlobalShortSize {
    pub asset: AssetId,
    pub global_short_size: u256
}

pub struct WritePoolAmount {
    pub asset: AssetId,
    pub pool_amount: u256,
}

pub struct WriteRusdAmount {
    pub asset: AssetId,
    pub rusd_amount: u256,
}

pub struct WriteReservedAmount {
    pub asset: AssetId,
    pub reserved_amount: u256,
}

pub struct WriteGuaranteedAmount {
    pub asset: AssetId,
    pub guaranteed_amount: u256,
}
