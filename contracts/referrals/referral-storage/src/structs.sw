
// SPDX-License-Identifier: Apache-2.0
library;

pub struct Tier {
    pub total_rebate: u64, // e.g. 2400 for 24%
    pub discount_share: u64, // 5000 for 50%/50%, 7000 for 30% rebates/70% discount
}