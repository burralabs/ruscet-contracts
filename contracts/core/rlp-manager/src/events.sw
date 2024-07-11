// SPDX-License-Identifier: Apache-2.0
library;

use helpers::context::*;

pub struct AddLiquidity {
    pub account: Account,
    pub asset: AssetId,
    pub amount: u64,
    pub aum_in_rusd: u256,
    pub rlp_supply: u64,
    pub rusd_amount: u256,
    pub mint_amount: u256
}

pub struct RemoveLiquidity {
    pub account: Account,
    pub asset: AssetId,
    pub rlp_amount: u64,
    pub aum_in_rusd: u256,
    pub rlp_supply: u64,
    pub rusd_amount: u256,
    pub amount_out: u256
}