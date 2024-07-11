// SPDX-License-Identifier: Apache-2.0
script;

use std::{
    context::*,
};
use helpers::{
    context::*, 
    utils::*,
    transfer::transfer_assets,
};

#[payable]
fn main(
    asset: AssetId,
    amount: u64,
    contr: ContractId
) -> bool {
    transfer_assets(
        asset,
        Account::from(contr),
        amount,
    );

    true
}