// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    signed_256::*,
};

use std::hash::*;

pub struct Position {
    pub size: u256,
    pub collateral: u256,
    pub average_price: u256,
    pub entry_funding_rate: u256,
    pub reserve_amount: u256,
    pub realized_pnl: Signed256,
    pub last_increased_time: u64
}

pub struct PositionKey {
    pub account: Account,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub is_long: bool,
}

abi VaultStorage {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        router: ContractId,
        rusd: AssetId,
        rusd_contr: ContractId,
        pricefeed_provider: ContractId,
        liquidation_fee_usd: u256,
        funding_rate_factor: u64,
        stable_funding_rate_factor: u64
    );

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(write)]
    fn set_gov(gov: Account);
    
    #[storage(write)]
    fn write_authorize(account: Account, is_authorized: bool);

    #[storage(write)]
    fn set_liquidator(liquidator: Account, is_active: bool);

    #[storage(write)]
    fn set_manager(manager: Account, is_manager: bool);

    #[storage(write)]
    fn set_in_manager_mode(mode: bool);

    #[storage(write)]
    fn set_in_private_liquidation_mode(mode: bool);

    #[storage(write)]
    fn set_is_swap_enabled(is_swap_enabled: bool);

    #[storage(write)]
    fn set_is_leverage_enabled(is_swap_enabled: bool);

    #[storage(write)]
    fn set_buffer_amount(asset: AssetId, buffer_amount: u256);

    #[storage(write)]
    fn set_max_leverage(max_leverage: u64);

    #[storage(write)]
    fn set_pricefeed(pricefeed: ContractId);

    #[storage(read, write)]
    fn set_fees(
        tax_basis_points: u64,
        stable_tax_basis_points: u64,
        mint_burn_fee_basis_points: u64,
        swap_fee_basis_points: u64,
        stable_swap_fee_basis_points: u64,
        margin_fee_basis_points: u64,
        liquidation_fee_usd: u256,
        min_profit_time: u64,
        has_dynamic_fees: bool,
    );

    #[storage(read, write)]
    fn set_funding_rate(
        funding_interval: u64, 
        funding_rate_factor: u64, 
        stable_funding_rate_factor: u64
    );

    #[storage(read, write)]
    fn set_asset_config(
        asset: AssetId,
        asset_decimals: u8,
        asset_weight: u64,
        min_profit_bps: u64,
        max_rusd_amount: u256,
        is_stable: bool,
        is_shortable: bool
    );

    #[storage(read, write)]
    fn clear_asset_config(asset: AssetId);

    #[storage(write)]
    fn set_router(router: Account, is_active: bool);

    #[storage(write)]
    fn set_max_global_short_size(asset: AssetId, max_global_short_size: u256);

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn is_initialized() -> bool;
    
    #[storage(read)]
    fn has_dynamic_fees() -> bool;

    #[storage(read)]
    fn get_min_profit_time() -> u64;

    #[storage(read)]
    fn get_liquidation_fee_usd() -> u256;

    #[storage(read)]
    fn get_tax_basis_points() -> u64;

    #[storage(read)]
    fn get_stable_tax_basis_points() -> u64;

    #[storage(read)]
    fn get_mint_burn_fee_basis_points() -> u64;

    #[storage(read)]
    fn get_swap_fee_basis_points() -> u64;

    #[storage(read)]
    fn get_stable_swap_fee_basis_points() -> u64;

    #[storage(read)]
    fn get_margin_fee_basis_points() -> u64;

    #[storage(read)]
    fn get_router() -> ContractId;

    #[storage(read)]
    fn get_rusd_contr() -> ContractId;

    #[storage(read)]
    fn get_rusd() -> AssetId;

    #[storage(read)]
    fn get_pricefeed_provider() -> ContractId;

    #[storage(read)]
    fn get_funding_interval() -> u64;

    #[storage(read)]
    fn get_funding_rate_factor() -> u64;

    #[storage(read)]
    fn get_stable_funding_rate_factor() -> u64;

    #[storage(read)]
    fn get_total_asset_weights() -> u64;

    #[storage(read)]
    fn is_approved_router(account1: Account, account2: Account) -> bool;

    #[storage(read)]
    fn is_liquidator(account: Account) -> bool;

    #[storage(read)]
    fn get_all_whitelisted_assets_length() -> u64;

    #[storage(read)]
    fn get_whitelisted_asset_by_index(index: u64) -> AssetId;

    #[storage(read)]
    fn get_whitelisted_asset_count() -> u64;

    #[storage(read)]
    fn is_asset_whitelisted(asset: AssetId) -> bool;

    #[storage(read)]
    fn get_asset_decimals(asset: AssetId) -> u8;

    #[storage(read)]
    fn get_min_profit_basis_points(asset: AssetId) -> u64;

    #[storage(read)]
    fn is_stable_asset(asset: AssetId) -> bool;

    #[storage(read)]
    fn is_shortable_asset(asset: AssetId) -> bool;

    #[storage(read)]
    fn get_asset_weight(asset: AssetId) -> u64;

    #[storage(read)]
    fn get_max_rusd_amount(asset: AssetId) -> u256;

    #[storage(read)]
    fn is_swap_enabled() -> bool;

    #[storage(read)]
    fn is_leverage_enabled() -> bool;

    #[storage(read)]
    fn get_include_amm_price() -> bool;

    #[storage(read)]
    fn get_use_swap_pricing() -> bool;

    #[storage(read)]
    fn get_max_leverage() -> u64;

    #[storage(read)]
    fn get_is_manager(account: Account) -> bool;

    #[storage(read)]
    fn get_in_manager_mode() -> bool;

    #[storage(read)]
    fn in_private_liquidation_mode() -> bool;
    
    #[storage(read)]
    fn get_asset_balance(asset: AssetId) -> u64;

    #[storage(read)]
    fn get_buffer_amounts(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_last_funding_times(asset: AssetId) -> u64;

    #[storage(read)]
    fn get_position_by_key(position_key: b256) -> Position;

    #[storage(read)]
    fn get_fee_reserves(asset: AssetId) -> u256;
    
    #[storage(read)]
    fn get_global_short_average_prices(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_max_global_short_sizes(asset: AssetId) -> u256;

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(write)]
    fn write_max_rusd_amount(asset: AssetId, max_rusd_amount: u256);

    #[storage(write)]
    fn write_include_amm_price(include_amm_price: bool);

    #[storage(write)]
    fn write_use_swap_pricing(use_swap_pricing: bool);

    #[storage(write)]
    fn write_asset_balance(asset: AssetId, bal: u64);

    #[storage(write)]
    fn write_buffer_amount(asset: AssetId, buffer_amount: u256);

    #[storage(write)]
    fn write_last_funding_time(asset: AssetId, last_funding_time: u64);

    #[storage(write)]
    fn write_position(position_key: b256, position: Position);

    #[storage(write)]
    fn write_fee_reserve(asset: AssetId, fee_reserve: u256);

    #[storage(write)]
    fn write_global_short_average_price(asset: AssetId, global_short_average_price: u256);
}

impl Hash for PositionKey {
    fn hash(self, ref mut state: Hasher) {
        self.account.hash(state);
        self.collateral_asset.hash(state);
        self.index_asset.hash(state);
        self.is_long.hash(state);
    }
}

impl Position {
    pub fn default() -> Self {
        Position {
            size: 0,
            collateral: 0,
            average_price: 0,
            entry_funding_rate: 0,
            reserve_amount: 0,
            realized_pnl: Signed256::from(0),
            last_increased_time: 0,
        }
    }
}