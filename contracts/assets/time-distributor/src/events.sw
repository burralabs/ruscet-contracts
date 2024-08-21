// SPDX-License-Identifier: Apache-2.0
library;

use helpers::context::*;

pub struct Distribute {
    pub receiver: Account,
    pub amount: u64
}

pub struct DistributionChange {
    pub receiver: Account,
    pub amount: u64,
    pub reward_asset: AssetId
}

pub struct AssetsPerIntervalChange {
    pub receiver: Account,
    pub amount: u64
}