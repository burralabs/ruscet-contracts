// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____                _           
|  _ \ ___  __ _  __| | ___ _ __ 
| |_) / _ \/ _` |/ _` |/ _ \ '__|
|  _ <  __/ (_| | (_| |  __/ |
|_| \_\___|\__,_|\__,_|\___|_|
*/

use std::{
    block::timestamp,
    context::*,
    revert::require,
    primitive_conversions::u64::*
};
use std::hash::*;
use peripheral_interfaces::reader::Reader;
use core_interfaces::{
    vault_pricefeed::VaultPricefeed,
    base_position_manager::BasePositionManager,
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
    asset::*,
    signed_256::Signed256
};

storage {
    is_initialized: bool = false,
    gov: Account = ZERO_ACCOUNT,
    has_max_global_short_sizes: bool = false
}

enum Error {
    ReaderAlreadyInitialized: (),
    ReaderNotGov: (),
}

impl Reader for Contract {
    #[storage(read, write)]
    fn initialize(has_max_global_short_sizes: bool) {
        require(!storage.is_initialized.read(), Error::ReaderAlreadyInitialized);
        storage.is_initialized.write(true);

        storage.gov.write(get_sender());
        storage.has_max_global_short_sizes.write(has_max_global_short_sizes);
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_gov(new_gov: Account) {
        _only_gov();
        storage.gov.write(new_gov);
    }
    
    #[storage(read, write)]
    fn set_config(has_max_global_short_sizes: bool) {
        _only_gov();
        storage.has_max_global_short_sizes.write(has_max_global_short_sizes);
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/
    */
    fn get_fees(
        vault_: ContractId,
        assets: Vec<AssetId>
    ) -> Vec<u256> {
        let vault = abi(Vault, vault_.into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());

        let mut amounts: Vec<u256> = Vec::new();
        let mut i = 0;

        while i < assets.len() {
            let asset = assets.get(i).unwrap();

            amounts.push(vault_storage.get_fee_reserves(asset));

            i += 1;
        }

        amounts
    }

    fn get_funding_rates(
        vault_: ContractId,
        assets: Vec<AssetId>
    ) -> Vec<u256> {
        _get_funding_rates(
            vault_,
            assets
        )
    }

    fn get_prices(
        vault_pricefeed: ContractId,
        assets: Vec<AssetId>
    ) -> Vec<u256> {
        _get_prices(
            vault_pricefeed,
            assets
        )
    }

    fn get_vault_asset_info(
        vault_: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256> {
        let _props_len = 10;

        let vault = abi(Vault, vault_.into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
        let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());
        let pricefeed = abi(VaultPricefeed, vault_storage.get_pricefeed_provider().into());

        let mut amounts: Vec<u256> = Vec::new();
        let mut i = 0;

        while i < assets.len() {
            let asset = assets.get(i).unwrap();

            amounts.push(vault_utils.get_pool_amounts(asset));
            amounts.push(vault_utils.get_reserved_amounts(asset));
            amounts.push(vault_utils.get_rusd_amount(asset));
            amounts.push(vault_utils.get_redemption_amount(asset, rusd_amount));
            amounts.push(vault_storage.get_asset_weight(asset).as_u256());
            amounts.push(vault_utils.get_min_price(asset));
            amounts.push(vault_utils.get_max_price(asset));
            
            amounts.push(vault_utils.get_guaranteed_usd(asset));
            amounts.push(pricefeed.get_primary_price(asset, false));
            amounts.push(pricefeed.get_primary_price(asset, true));

            i += 1;
        }
        
        amounts
    }

    fn get_full_vault_asset_info(
        vault_: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256> {
        let _props_len = 12;

        let vault = abi(Vault, vault_.into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
        let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());
        let pricefeed = abi(VaultPricefeed, vault_storage.get_pricefeed_provider().into());

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
            amounts.push(vault_utils.get_min_price(asset));
            amounts.push(vault_utils.get_max_price(asset));
            amounts.push(vault_utils.get_guaranteed_usd(asset));
            amounts.push(pricefeed.get_primary_price(asset, false));
            amounts.push(pricefeed.get_primary_price(asset, true));

            i += 1;
        }
        
        amounts
    }

    #[storage(read)]
    fn get_full_vault_asset_info_v2(
        vault_: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256> {
        let _props_len = 14;

        let vault = abi(Vault, vault_.into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
        let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());
        let pricefeed = abi(VaultPricefeed, vault_storage.get_pricefeed_provider().into());
        let has_max_global_short_sizes = storage.has_max_global_short_sizes.read();

        let mut amounts: Vec<u256> = Vec::new();
        let mut i = 0;

        while i < assets.len() {
            let asset = assets.get(i).unwrap();

            let max_global_short_size = if has_max_global_short_sizes {
                vault_storage.get_max_global_short_sizes(asset)
            } else {
                0
            };

            amounts.push(vault_utils.get_pool_amounts(asset));
            amounts.push(vault_utils.get_reserved_amounts(asset));
            amounts.push(vault_utils.get_rusd_amount(asset));
            amounts.push(vault_utils.get_redemption_amount(asset, rusd_amount));
            amounts.push(vault_storage.get_asset_weight(asset).as_u256());
            amounts.push(vault_storage.get_buffer_amounts(asset));
            amounts.push(vault_storage.get_max_rusd_amount(asset));
            amounts.push(vault_utils.get_global_short_sizes(asset));
            amounts.push(max_global_short_size);
            amounts.push(vault_utils.get_min_price(asset));
            amounts.push(vault_utils.get_max_price(asset));
            amounts.push(vault_utils.get_guaranteed_usd(asset));
            amounts.push(pricefeed.get_primary_price(asset, false));
            amounts.push(pricefeed.get_primary_price(asset, true));

            i += 1;
        }
        
        amounts
    }

    fn get_positions(
        vault_: ContractId,
        account: Account,
        collateral_assets: Vec<AssetId>,
        index_assets: Vec<AssetId>,
        is_longs: Vec<bool>
    ) -> Vec<u256> {
        let _props_len = 9;

        let vault = abi(Vault, vault_.into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
        let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());

        let mut amounts: Vec<u256> = Vec::new();
        let mut i = 0;

        while i < collateral_assets.len() {
            let collateral_asset = collateral_assets.get(i).unwrap();
            let index_asset = index_assets.get(i).unwrap();
            let is_long = is_longs.get(i).unwrap();

            let mut size = 0;
            let mut average_price = 0;
            let mut last_increased_time = 0;
            {
                let (
                    size_,
                    collateral,
                    average_price_,
                    entry_funding_rate,
                    _,
                    realized_pnl,
                    has_realized_profit,
                    last_increased_time_
                ) = vault_utils.get_position(account, collateral_asset, index_asset, is_long);
                size = size_;
                average_price = average_price_;
                last_increased_time = last_increased_time_;

                amounts.push(size);
                amounts.push(collateral);
                amounts.push(average_price);
                amounts.push(entry_funding_rate);
                amounts.push(if has_realized_profit { 1 } else { 0 });
                amounts.push(realized_pnl.value); // @TODO: this might be a bug (Signed256 -> u256)
                amounts.push(last_increased_time.as_u256());
            }

            if average_price > 0 {
                let (has_profit, delta) = vault_utils.get_delta(
                    index_asset, 
                    size, 
                    average_price, 
                    is_long, 
                    last_increased_time
                );
                amounts.push(if has_profit { 1 } else { 0 });
                amounts.push(delta);
            } else {
                // just temporary values to keep the array length in the frontend consistent
                amounts.push(0);
                amounts.push(69);
            }

            i += 1;
        }

        amounts
    }
}

#[storage(read)]
fn _only_gov() {
    require(get_sender() == storage.gov.read(), Error::ReaderNotGov);
}

fn _get_funding_rates(
    vault_: ContractId,
    assets: Vec<AssetId>
) -> Vec<u256> {
    let _props_len = 2;

    let vault = abi(Vault, vault_.into());
    let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
    let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());

    let mut funding_rates: Vec<u256> = Vec::new();
    let mut i = 0;

    while i < assets.len() {
        let asset = assets.get(i).unwrap();

        let funding_rate_factor = if vault_storage.is_stable_asset(asset) {
            vault_storage.get_stable_funding_rate_factor()
        } else {
            vault_storage.get_funding_rate_factor()
        };

        {
            let reserved_amounts = vault_utils.get_reserved_amounts(asset);
            let pool_amount = vault_utils.get_pool_amounts(asset);

            if pool_amount > 0 {
                funding_rates.push(funding_rate_factor.as_u256() * reserved_amounts / pool_amount);
            }
        }

        let cumulative_funding_rate_ = vault_utils.get_cumulative_funding_rates(asset);
        if cumulative_funding_rate_ > 0 {
            let next_rate = vault_utils.get_next_funding_rate(asset);
            let base_rate = cumulative_funding_rate_;
            funding_rates.push(base_rate + next_rate);
        }

        i += 1;
    }

    if funding_rates.len() == 0 {
        funding_rates.push(69420); // dummy value
    }
    
    funding_rates
}

fn _get_prices(
    vault_pricefeed: ContractId,
    assets: Vec<AssetId>
) -> Vec<u256> {
    let _props_len = 10;

    let pricefeed = abi(VaultPricefeed, vault_pricefeed.into());

    let mut amounts: Vec<u256> = Vec::new();
    let mut i = 0;

    while i < assets.len() {
        let asset = assets.get(i).unwrap();

        amounts.push(pricefeed.get_price(asset, true, true, false));
        amounts.push(pricefeed.get_price(asset, false, true, false));
        amounts.push(pricefeed.get_primary_price(asset, true));
        amounts.push(pricefeed.get_primary_price(asset, false));
        amounts.push(if pricefeed.is_adjustment_additive(asset) { 1 } else { 0 });
        amounts.push(pricefeed.get_adjustment_basis_points(asset).as_u256());

        i += 1;
    }
    
    amounts
}