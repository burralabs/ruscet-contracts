// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    call_frames::msg_asset_id,
    context::*,
    primitive_conversions::{
        u8::*,
        u64::*,
    }
};
use std::hash::*;
use core_interfaces::{
    vault_utils::VaultUtils,
    vault::Vault,
    vault_storage::{
        VaultStorage,
        PositionKey,
    },
};
use helpers::{
    context::*, 
    utils::*,
    transfer::transfer_assets,
    signed_256::*,
    zero::*
};
use ::constants::*;
use ::events::*;
use ::errors::*;

pub fn _get_position_key(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    is_long: bool,
) -> b256 {
    keccak256(PositionKey {
        account,
        collateral_asset,
        index_asset,
        is_long,
    })
}

pub fn _validate_router(
    account: Account,
    vault_storage_: ContractId,
    tx_sender: Account
) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    if tx_sender == account || tx_sender == Account::from(vault_storage.get_router()) {
        return;
    }

    require(
        vault_storage.is_approved_router(account, tx_sender),
        Error::VaultRouterInvalidMsgCaller
    );
}

pub fn _validate_assets(
    collateral_asset: AssetId,
    index_asset: AssetId,
    is_long: bool,
    vault_storage_: ContractId
) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    require(
        vault_storage.is_asset_whitelisted(collateral_asset),
        Error::VaultRouterCollateralAssetNotWhitelisted
    );

    let collateral_is_stable = vault_storage.is_stable_asset(collateral_asset);

    if is_long {
        require(
            collateral_asset == index_asset,
            Error::VaultRouterLongCollateralIndexAssetsMismatch
        );
        require(
            !collateral_is_stable,
            Error::VaultRouterLongCollateralAssetMustNotBeStableAsset
        );

        return;
    }

    require(
        collateral_is_stable,
        Error::VaultRouterShortCollateralAssetMustBeStableAsset
    );
    require(
        !vault_storage.is_stable_asset(index_asset),
        Error::VaultRouterShortIndexAssetMustNotBeStableAsset
    );
    require(
        vault_storage.is_shortable_asset(index_asset),
        Error::VaultRouterShortIndexAssetNotShortable
    );
}

pub fn _validate_position(size: u256, collateral: u256) {
    if size == 0 {
        require(
            collateral == 0,
            Error::VaultRouterCollateralShouldBeWithdrawn
        );
        return;
    }

    require(
        size >= collateral,
        Error::VaultRouterSizeMustBeMoreThanCollateral
    );
}

pub fn _validate_buffer_amount(
    asset: AssetId, 
    vault_storage_: ContractId, 
    vault_utils_: ContractId
) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());
    
    if vault_utils.get_pool_amounts(asset) < vault_storage.get_buffer_amounts(asset) {
        require(false, Error::VaultRouterPoolAmountLtBuffer);
    }
}

pub fn _transfer_in(
    asset_id: AssetId,
    vault_: ContractId
) -> u64 {
    let amount = msg_amount();
    if amount > 0 {
        require(
            msg_asset_id() == asset_id,
            Error::VaultRouterInvalidAssetForwarded
        );

        // transfer assets to the Vault
        transfer_assets(
            asset_id,
            Account::from(vault_),
            amount
        );
    }

    amount
}

pub fn _transfer_out(
    asset_id: AssetId, 
    amount: u64, 
    receiver: Account,
    vault_: ContractId
) {
    let vault = abi(Vault, vault_.into());
    vault.transfer_out(
        asset_id,
        amount,
        receiver,
    );
}

// for longs:  next_average_price = (next_price * next_size) / (next_size + delta)
// for shorts: next_average_price = (next_price * next_size) / (next_size - delta)
pub fn _get_next_average_price(
    index_asset: AssetId,
    size: u256,
    average_price: u256,
    is_long: bool,
    next_price: u256,
    size_delta: u256,
    last_increased_time: u64,
    vault_utils_: ContractId
) -> u256 {
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    let (has_profit, delta) = vault_utils.get_delta(
        index_asset,
        size,
        average_price,
        is_long,
        last_increased_time
    );

    let next_size = size + size_delta;
    let mut divisor = 0;
    if is_long {
        divisor = if has_profit { next_size + delta } else { next_size - delta }
    } else {
        divisor = if has_profit { next_size - delta } else { next_size + delta }
    }

    next_price * next_size / divisor
}

// for longs:  next_average_price = (next_price * next_size) / (next_size + delta)
// for shorts: next_average_price = (next_price * next_size) / (next_size - delta)
pub fn _get_next_global_short_average_price(
    index_asset: AssetId,
    next_price: u256,
    size_delta: u256,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
) -> u256 {
    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    let size = vault_utils.get_global_short_sizes(index_asset);
    let average_price = vault_storage.get_global_short_average_prices(index_asset);
    let has_profit = average_price > next_price;

    let price_delta = if has_profit {
        average_price - next_price
    } else {
        next_price - average_price
    };

    let delta = size * price_delta / average_price; 

    let next_size = size + size_delta;

    let divisor = if has_profit {
        next_size - delta
    } else {
        next_size + delta
    };

    next_price * next_size / divisor
}

pub fn _collect_margin_fees(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    is_long: bool,
    size_delta: u256,
    size: u256,
    entry_funding_rate: u256,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
) -> u256 {
    let mut fee_usd: u256 = 0;
    let mut fee_assets: u256 = 0;

    let vault_utils = abi(VaultUtils, vault_utils_.into());
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    let position_fee = vault_utils.get_position_fee(
        account,
        collateral_asset,
        index_asset,
        is_long,
        size_delta
    );

    let funding_fee = vault_utils.get_funding_fee(
        collateral_asset,
        size,
        entry_funding_rate
    );

    fee_usd = position_fee + funding_fee;

    fee_assets = vault_storage.usd_to_asset_min(collateral_asset, fee_usd);
    let new_fee_reserve =  vault_storage.get_fee_reserves(collateral_asset) + fee_assets;
    vault_storage.write_fee_reserve(
        collateral_asset,
        new_fee_reserve
    );

    log(CollectMarginFees {
        asset: collateral_asset,
        fee_usd,
        fee_assets,
    });

    fee_usd
}