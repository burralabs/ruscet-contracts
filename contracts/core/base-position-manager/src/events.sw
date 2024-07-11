// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{context::*};

pub struct SetDepositFee {
    pub deposit_fee: u64
}

pub struct SetIncreasePositionBufferBps {
    pub increase_position_buffer_bps: u64
}

pub struct SetReferralStorage {
    pub referral_storage: ContractId
}

pub struct SetAdmin {
    pub admin: Account
}

pub struct WithdrawFees {
    pub asset: AssetId,
    pub receiver: Account,
    pub amount: u64
}

pub struct SetMaxGlobalSize {
    pub assets: Vec<AssetId>,
    pub long_sizes: Vec<u256>,
    pub short_sizes: Vec<u256>,
}

pub struct IncreasePositionReferral {
    pub account: Account,
    pub size_delta: u256,
    pub margin_fee_basis_points: u64,
    pub referral_code: b256,
    pub referrer: Account
}

pub struct DecreasePositionReferral {
    pub account: Account,
    pub size_delta: u256,
    pub margin_fee_basis_points: u64,
    pub referral_code: b256,
    pub referrer: Account
}

pub struct LeverageDecreased {
    pub collateral_delta: u256,
    pub prev_leverage: u256,
    pub next_leverage: u256
}