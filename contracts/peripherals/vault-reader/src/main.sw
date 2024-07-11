// SPDX-License-Identifier: Apache-2.0
contract;

/*
__     __          _ _     ____                _           
\ \   / /_ _ _   _| | |_  |  _ \ ___  __ _  __| | ___ _ __ 
 \ \ / / _` | | | | | __| | |_) / _ \/ _` |/ _` |/ _ \ '__|
  \ V / (_| | |_| | | |_  |  _ <  __/ (_| | (_| |  __/ |
   \_/ \__,_|\__,_|_|\__| |_| \_\___|\__,_|\__,_|\___|_|
*/

use std::{
    block::timestamp,
    context::*,
    revert::require,
    primitive_conversions::u64::*
};
use std::hash::*;
use peripheral_interfaces::vault_reader::VaultReader;
use core_interfaces::{
    vault_pricefeed::VaultPricefeed,
    base_position_manager::BasePositionManager,
    position_manager::PositionManager,
    vault::Vault,
    vault_storage::VaultStorage,
    vault_utils::VaultUtils,
};
use interfaces::wrapped_asset::{
    WrappedAsset as WrappedAssetABI
};
use helpers::{
    context::*, 
    utils::*,
    transfer::*,
    asset::*
};

impl VaultReader for Contract {
    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/
    */
    fn get_vault_asset_info_v3(
        vault_: ContractId,
        position_manager_or_router: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256> {
        let _props_len = 14;

        let vault = abi(Vault, vault_.into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
        let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());
        let pricefeed = abi(VaultPricefeed, vault_storage.get_pricefeed_provider().into());
        let position_manager = abi(PositionManager, position_manager_or_router.into());
        let base_position_manager = abi(BasePositionManager, position_manager.get_base_position_manager().into());

        let mut amounts: Vec<u256> = Vec::new();
        let mut i = 0;

        while i < assets.len() {
            let asset = assets.get(i).unwrap();

            amounts.push(vault_utils.get_pool_amounts(asset));
            amounts.push(vault_utils.get_reserved_amounts(asset));
            amounts.push(vault_utils.get_rusd_amount(asset));
            amounts.push(vault_utils.get_redemption_amount(asset, rusd_amount));
            amounts.push(vault_storage.get_asset_weight(asset).as_u256());
            amounts.push(vault_storage.get_buffer_amounts(asset));
            amounts.push(vault_storage.get_max_rusd_amount(asset));
            amounts.push(vault_utils.get_global_short_sizes(asset));
            amounts.push(base_position_manager.get_max_global_short_sizes(asset));
            amounts.push(vault_utils.get_min_price(asset));
            amounts.push(vault_utils.get_max_price(asset));
            amounts.push(vault_utils.get_guaranteed_usd(asset));
            amounts.push(pricefeed.get_primary_price(asset, false));
            amounts.push(pricefeed.get_primary_price(asset, true));

            i += 1;
        }
        
        amounts
    }

    fn get_vault_asset_info_v4(
        vault_: ContractId,
        position_manager_or_router: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256> {
        let _props_len = 15;

        let vault = abi(Vault, vault_.into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
        let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());
        let pricefeed = abi(VaultPricefeed, vault_storage.get_pricefeed_provider().into());
        let position_manager = abi(PositionManager, position_manager_or_router.into());
        let base_position_manager = abi(BasePositionManager, position_manager.get_base_position_manager().into());

        let mut amounts: Vec<u256> = Vec::new();
        let mut i = 0;

        while i < assets.len() {
            let asset = assets.get(i).unwrap();

            amounts.push(vault_utils.get_pool_amounts(asset));
            amounts.push(vault_utils.get_reserved_amounts(asset));
            amounts.push(vault_utils.get_rusd_amount(asset));
            amounts.push(vault_utils.get_redemption_amount(asset, rusd_amount));
            amounts.push(vault_storage.get_asset_weight(asset).as_u256());
            amounts.push(vault_storage.get_buffer_amounts(asset));
            amounts.push(vault_storage.get_max_rusd_amount(asset));
            amounts.push(vault_utils.get_global_short_sizes(asset));
            amounts.push(base_position_manager.get_max_global_short_sizes(asset));
            amounts.push(base_position_manager.get_max_global_long_sizes(asset));
            amounts.push(vault_utils.get_min_price(asset));
            amounts.push(vault_utils.get_max_price(asset));
            amounts.push(vault_utils.get_guaranteed_usd(asset));
            amounts.push(pricefeed.get_primary_price(asset, false));
            amounts.push(pricefeed.get_primary_price(asset, true));

            i += 1;
        }
        
        amounts
    }
}