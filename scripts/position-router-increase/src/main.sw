// SPDX-License-Identifier: Apache-2.0
script;

use std::{
    call_frames::msg_asset_id,
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

struct PriceUpdateData {
    asset_id: AssetId,
    price: u256,
}

enum Error {
    InvalidForwardedAmount: (),
    InvalidForwardedAsset: (),
}

#[payable]
fn main(
    path: Vec<AssetId>,
    index_asset: AssetId,
    amount_in: u64,
    min_out: u64,
    size_delta: u256,
    is_long: bool,
    acceptable_price: u256,
    referral_code: b256,
    price_update_data: Vec<PriceUpdateData>
) {
    // transfer forwarded assets
    let asset = path.get(0).unwrap();
    // there is NO check for the msg_amount() and msg_asset_id() here because these values are incorrect
    // especially in a Script context
    // Script will revert anyway because the required assets aren't being forwarded to PositionRouter
    transfer_assets(
        asset,
        Account::from(POSITION_ROUTER),
        amount_in
    );

    // update price first
    update_price_data(price_update_data);

    // increase position
    let position_router = abi(PositionRouter, POSITION_ROUTER.into());
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

fn update_price_data(price_update_data: Vec<PriceUpdateData>) {
    let vault_pricefeed = abi(VaultPricefeed, VAULT_PRICEFEED.into());
    let mut i = 0;
    let _len = price_update_data.len();
    while i < _len {
        let data = price_update_data.get(i).unwrap();
        vault_pricefeed.update_price(data.asset_id, data.price);
        i += 1;
    }
}