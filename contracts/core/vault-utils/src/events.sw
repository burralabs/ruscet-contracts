// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::Account,
    signed_256::*
};

pub struct SetGov {
    pub new_gov: Account
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

pub struct IncreasePoolAmount {
    pub asset: AssetId,
    pub amount: u256,
}

pub struct DecreasePoolAmount {
    pub asset: AssetId,
    pub amount: u256,
}

pub struct WriteRusdAmount {
    pub asset: AssetId,
    pub rusd_amount: u256,
}

pub struct IncreaseRusdAmount {
    pub asset: AssetId,
    pub amount: u256,
}

pub struct DecreaseRusdAmount {
    pub asset: AssetId,
    pub amount: u256,
}

pub struct WriteReservedAmount {
    pub asset: AssetId,
    pub reserved_amount: u256,
}

pub struct IncreaseReservedAmount {
    pub asset: AssetId,
    pub amount: u256,
}

pub struct DecreaseReservedAmount {
    pub asset: AssetId,
    pub amount: u256,
}

pub struct WriteGuaranteedAmount {
    pub asset: AssetId,
    pub guaranteed_amount: u256,
}

pub struct IncreaseGuaranteedAmount {
    pub asset: AssetId,
    pub amount: u256,
}

pub struct DecreaseGuaranteedAmount {
    pub asset: AssetId,
    pub amount: u256,
}