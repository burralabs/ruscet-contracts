// SPDX-License-Identifier: Apache-2.0
script;

use std::{
    context::*,
    bytes::*,
};
use helpers::{
    context::*, 
    utils::*,
    transfer::transfer_assets,
};
use core_interfaces::{
    position_router::*,
    vault_pricefeed::*,
};

configurable {
    VAULT_PRICEFEED: ContractId = ZERO_CONTRACT,
    POSITION_ROUTER: ContractId = ZERO_CONTRACT,
}

fn main() -> bool {
    true
}

#[payable]
fn update_price_and_increase_position(
    path: Vec<AssetId>,
    index_asset: AssetId,
    amount_in: u64,
    min_out: u64,
    size_delta: u256,
    is_long: bool,
    acceptable_price: u256,
    referral_code: b256,
    price_update_data: Vec<Bytes>
) {
    let vault_pricefeed = abi(VaultPricefeed, VAULT_PRICEFEED.into());
    let position_router = abi(PositionRouter, POSITION_ROUTER.into());

    // update price first
    vault_pricefeed.update_pyth_price{
        asset_id: AssetId::base().into(),
        coins: msg_amount()
    }(price_update_data);

    // increase position
    position_router.increase_position(
        path,
        index_asset,
        amount_in,
        min_out,
        size_delta,
        is_long,
        acceptable_price,
        referral_code
    );
}