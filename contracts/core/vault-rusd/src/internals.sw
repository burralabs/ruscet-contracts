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

pub fn _collect_swap_fees(
    asset: AssetId, 
    amount: u64, 
    fee_basis_points: u64, 
    vault_storage_: ContractId, 
) -> u64 {
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    let after_fee_amount = amount * (BASIS_POINTS_DIVISOR - fee_basis_points) / BASIS_POINTS_DIVISOR;
    let fee_amount = amount - after_fee_amount;

    let fee_reserve = vault_storage.get_fee_reserves(asset);
    vault_storage.write_fee_reserve(asset, fee_reserve + fee_amount.as_u256());

    log(CollectSwapFees {
        asset,
        fee_usd: vault_storage.asset_to_usd_min(asset, fee_amount.as_u256()),
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