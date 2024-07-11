
// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*, 
    utils::*,
};

pub struct SetHandler {
    pub handler: Account,
    pub is_active: bool
}

pub struct SetTraderReferralCode {
    pub account: Account,
    pub code: b256
}

pub struct SetTier {
    pub tier_id: u64,
    pub total_rebate: u64,
    pub discount_share: u64
}

pub struct SetReferrerTier {
    pub referrer: Account,
    pub tier_id: u64
}

pub struct SetReferrerDiscountShare {
    pub referrer: Account,
    pub discount_share: u64
}

pub struct RegisterCode {
    pub account: Account,
    pub code: b256
}

pub struct SetCodeOwner {
    pub account: Account,
    pub new_account: Account,
    pub code: b256
}

pub struct GovSetCodeOwner {
    pub new_account: Account,
    pub code: b256
}