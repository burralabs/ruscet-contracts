// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    asset::*,
};

abi Reader {
    #[storage(read, write)]
    fn initialize(has_max_global_short_sizes: bool);

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
    fn set_config(has_max_global_short_sizes: bool);

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/
    */
    fn get_fees(
        vault: ContractId,
        assets: Vec<AssetId>
    ) -> Vec<u256>;

    fn get_funding_rates(
        vault_: ContractId,
        assets: Vec<AssetId>
    ) -> Vec<u256>;
    
    fn get_prices(
        vault_pricefeed: ContractId,
        assets: Vec<AssetId>
    ) -> Vec<u256>;

    fn get_vault_asset_info(
        vault_: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256>;

    fn get_full_vault_asset_info(
        vault_: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256>;

    #[storage(read)]
    fn get_full_vault_asset_info_v2(
        vault_: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256>;

    fn get_positions(
        vault_: ContractId,
        account: Account,
        collateral_assets: Vec<AssetId>,
        index_assets: Vec<AssetId>,
        is_long: Vec<bool>
    ) -> Vec<u256>;
} 