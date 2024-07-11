// SPDX-License-Identifier: Apache-2.0
library;

/*
    `Account` is a unified type for cases where we don't care about the `Identity` of the sender
*/ 
use std::{
    auth::msg_sender,
    asset::{
        transfer
    },
};
use std::hash::{Hash, Hasher};
use ::context::*;
use ::utils::account_to_identity;

pub fn transfer_assets(
    asset: AssetId,
    to: Account,
    amount: u64,
) {
    transfer(
        account_to_identity(to),
        asset,
        amount
    );
    
    // The following doesn't work for `Address`s for some weird reason

    // if !to.is_contract {
    //     revert(0);
    //     transfer_to_address(to.into(), asset, amount);
    // } else {
    //     force_transfer_to_contract(to.into(), asset, amount);
    // }
}