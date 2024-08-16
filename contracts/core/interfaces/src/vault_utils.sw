// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    signed_256::*,
};
use ::vault_storage::Position;

abi VaultUtils {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault: ContractId,
        vault_storage: ContractId,
    );

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_gov(new_gov: Account);

    #[storage(read, write)]
    fn write_authorize(caller: Account, is_active: bool);

    #[storage(read, write)]
    fn set_rusd_amount(asset: AssetId, amount: u256);
    
    /*
          ____ __     ___          
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_gov() -> Account;

    #[storage(read)]
    fn is_authorized_caller(account: Account) -> bool;

    #[storage(read)]
    fn get_vault_storage() -> ContractId;

    #[storage(read)]
    fn get_pool_amounts(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_rusd_amount(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_reserved_amounts(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_global_short_sizes(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_guaranteed_usd(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_cumulative_funding_rates(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
    ) -> (
        u256, u256, u256,
        u256, u256, Signed256,
        bool, u64
    );

    #[storage(read)]
    fn get_position_delta(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
    ) -> (bool, u256);

    #[storage(read)]
    fn get_delta(
        index_asset: AssetId,
        size: u256,
        average_price: u256,
        is_long: bool,
        last_increased_time: u64
    ) -> (bool, u256);

    #[storage(read)]
    fn get_entry_funding_rate(
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool 
    ) -> u256;

    #[storage(read)]
    fn get_next_funding_rate(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_funding_fee(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        size: u256,
        entry_funding_rate: u256
    ) -> u256;

    #[storage(read)]
    fn get_position_fee(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        size_delta: u256,
    ) -> u256;

    #[storage(read)]
    fn get_max_price(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_min_price(asset: AssetId) -> u256;

    #[storage(read)]
    fn asset_to_usd_min(
        asset: AssetId, 
        asset_amount: u256
    ) -> u256;

    #[storage(read)]
    fn usd_to_asset_max(
        asset: AssetId, 
        usd_amount: u256
    ) -> u256;

    #[storage(read)]
    fn usd_to_asset_min(
        asset: AssetId, 
        usd_amount: u256
    ) -> u256;

    #[storage(read)]
    fn usd_to_asset(
        asset: AssetId, 
        usd_amount: u256, 
        price: u256
    ) -> u256;

    #[storage(read)]
    fn get_redemption_amount(
        asset: AssetId, 
        rusd_amount: u256
    ) -> u256; 

    #[storage(read)]
    fn get_redemption_collateral(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_redemption_collateral_usd(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_fee_basis_points(
        asset: AssetId,
        rusd_delta: u256,
        fee_basis_points: u256,
        tax_basis_points: u256,
        increment: bool
    ) -> u256;

    #[storage(read)]
    fn get_target_rusd_amount(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_utilization(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_global_short_delta(asset: AssetId) -> (bool, u256);

    #[storage(read)]
    fn adjust_for_decimals(
        amount: u256, 
        asset_div: AssetId, 
        asset_mul: AssetId
    ) -> u256;

    #[storage(read)]
    fn validate_liquidation(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        should_raise: bool,
    ) -> (u256, u256);

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn increase_pool_amount(asset: AssetId, amount: u256);

    #[storage(read, write)]
    fn decrease_pool_amount(asset: AssetId, amount: u256);

    #[storage(read, write)]
    fn increase_rusd_amount(asset: AssetId, amount: u256);

    #[storage(read, write)]
    fn decrease_rusd_amount(asset: AssetId, amount: u256);

    #[storage(read, write)]
    fn increase_guaranteed_usd(asset: AssetId, usd_amount: u256);

    #[storage(read, write)]
    fn decrease_guaranteed_usd(asset: AssetId, usd_amount: u256);

    #[storage(read, write)]
    fn increase_reserved_amount(asset: AssetId, amount: u256);

    #[storage(read, write)]
    fn decrease_reserved_amount(asset: AssetId, amount: u256);

    #[storage(read, write)]
    fn increase_global_short_size(asset: AssetId, amount: u256);

    #[storage(read, write)]
    fn decrease_global_short_size(asset: AssetId, amount: u256);

    #[storage(read, write)]
    fn update_cumulative_funding_rate(
        collateral_asset: AssetId, 
        _index_asset: AssetId
    );
}