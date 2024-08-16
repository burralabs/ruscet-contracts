// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    context::*,
    primitive_conversions::{
        u8::*,
        u64::*,
    }
};
use std::hash::*;
use core_interfaces::{
    vault_utils::VaultUtils,
    vault_storage::{
        VaultStorage,
        Position,
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
    vault_storage_: ContractId
) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let sender = get_sender();

    if sender == account || sender == Account::from(vault_storage.get_router()) {
        return;
    }

    require(
        vault_storage.is_approved_router(account, sender),
        Error::VaultInvalidMsgCaller
    );
}

pub fn _validate_assets(
    collateral_asset: AssetId,
    index_asset: AssetId,
    is_long: bool,
    vault_storage_: ContractId
) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    if is_long {
        require(
            collateral_asset == index_asset,
            Error::VaultLongCollateralIndexAssetsMismatch
        );
        require(
            vault_storage.is_asset_whitelisted(collateral_asset),
            Error::VaultLongCollateralAssetNotWhitelisted
        );
        require(
            !vault_storage.is_stable_asset(collateral_asset),
            Error::VaultLongCollateralAssetMustNotBeStableAsset
        );

        return;
    }

    require(
        vault_storage.is_asset_whitelisted(collateral_asset),
        Error::VaultShortCollateralAssetNotWhitelisted
    );
    require(
        vault_storage.is_stable_asset(collateral_asset),
        Error::VaultShortCollateralAssetMustBeStableAsset
    );
    require(
        !vault_storage.is_stable_asset(index_asset),
        Error::VaultShortIndexAssetMustNotBeStableAsset
    );
    require(
        vault_storage.is_shortable_asset(index_asset),
        Error::VaultShortIndexAssetNotShortable
    );
}

pub fn _validate_position(size: u256, collateral: u256) {
    if size == 0 {
        require(
            collateral == 0,
            Error::VaultCollateralShouldBeWithdrawn
        );
        return;
    }

    require(
        size >= collateral,
        Error::VaultSizeMustBeMoreThanCollateral
    );
}

pub fn _validate_buffer_amount(
    asset: AssetId, 
    vault_storage_: ContractId, 
    vault_utils_: ContractId
) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());
    
    // let pool_amount = vault_utils.get_pool_amounts(asset);
    // let buffer_amount = vault_storage.get_buffer_amounts(asset);

    if vault_utils.get_pool_amounts(asset) < vault_storage.get_buffer_amounts(asset) {
        require(false, Error::VaultPoolAmountLtBuffer);
    }
}

pub fn _transfer_in(asset_id: AssetId, vault_storage_: ContractId) -> u64 {
    let vault_storage = abi(VaultStorage, vault_storage_.into());
    
    let prev_balance = vault_storage.get_asset_balance(asset_id);
    let next_balance = balance_of(ContractId::this(), asset_id);
    vault_storage.write_asset_balance(asset_id, next_balance);

    require(
        next_balance >= prev_balance,
        Error::VaultZeroAmountOfAssetForwarded
    );

    next_balance - prev_balance
}

pub fn _transfer_out(
    asset_id: AssetId, 
    amount: u64, 
    receiver: Account,
    vault_storage_: ContractId
) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    transfer_assets(
        asset_id,
        receiver,
        amount
    );
    vault_storage.write_asset_balance(asset_id, balance_of(ContractId::this(), asset_id));
}

// amount_out:   29810299800
// transferring: 99666666

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
        account,
        collateral_asset,
        index_asset,
        is_long,
        size,
        entry_funding_rate
    );

    fee_usd = position_fee + funding_fee;

    fee_assets = vault_utils.usd_to_asset_min(collateral_asset, fee_usd);
    // let old_fee_reserve = vault_storage.get_fee_reserves(collateral_asset);
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

pub fn _collect_swap_fees(
    asset: AssetId, 
    amount: u64, 
    fee_basis_points: u64, 
    vault_storage_: ContractId, 
    vault_utils_: ContractId
) -> u64 {
    let vault_utils = abi(VaultUtils, vault_utils_.into());
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    let after_fee_amount = amount * (BASIS_POINTS_DIVISOR - fee_basis_points) / BASIS_POINTS_DIVISOR;
    let fee_amount = amount - after_fee_amount;

    let fee_reserve = vault_storage.get_fee_reserves(asset);
    vault_storage.write_fee_reserve(asset, fee_reserve + fee_amount.as_u256());

    log(CollectSwapFees {
        asset,
        fee_usd: vault_utils.asset_to_usd_min(asset, fee_amount.as_u256()),
        fee_assets: fee_amount,
    });

    after_fee_amount
}

pub fn _get_swap_fee_basis_points(
    asset_in: AssetId,
    asset_out: AssetId,
    rusd_amount: u256,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
) -> u256 {
    let vault_utils = abi(VaultUtils, vault_utils_.into());
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    let is_stableswap = vault_storage.is_stable_asset(asset_in) && vault_storage.is_stable_asset(asset_out);

    let base_bps = if is_stableswap {
        vault_storage.get_stable_swap_fee_basis_points()
    } else {
        vault_storage.get_swap_fee_basis_points()
    };

    let tax_bps = if is_stableswap {
        vault_storage.get_stable_tax_basis_points()
    } else {
        vault_storage.get_tax_basis_points()
    };

    let fee_basis_points_0 = vault_utils.get_fee_basis_points(
        asset_in,
        rusd_amount,
        base_bps.as_u256(),
        tax_bps.as_u256(),
        true
    );
    let fee_basis_points_1 = vault_utils.get_fee_basis_points(
        asset_out,
        rusd_amount,
        base_bps.as_u256(),
        tax_bps.as_u256(),
        false
    );

    // use the higher of the two fee basis points
    if fee_basis_points_0 > fee_basis_points_1 {
        fee_basis_points_0
    } else {
        fee_basis_points_1
    }
}

pub fn _validate_manager(vault_storage_: ContractId) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    if vault_storage.get_in_manager_mode() {
        require(
            vault_storage.get_is_manager(get_sender()),
            Error::VaultForbiddenNotManager
        );
    }
}