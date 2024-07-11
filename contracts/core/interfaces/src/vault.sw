// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
};

abi Vault {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault_utils: ContractId,
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

    #[storage(read)]
    fn withdraw_fees(
        asset: AssetId,
        receiver: Account 
    );

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
    fn get_vault_storage() -> ContractId;

    #[storage(read)]
    fn get_vault_utils() -> ContractId;

    fn get_position_key(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
    ) -> b256;

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read)]
    fn update_cumulative_funding_rate(
        collateral_asset: AssetId, 
        index_asset: AssetId
    );

    #[payable]
    #[storage(read)]
    fn direct_pool_deposit(asset: AssetId);

    #[storage(read)]
    fn buy_rusd(asset: AssetId, receiver: Account) -> u256;

    #[storage(read)]
    fn sell_rusd(asset: AssetId, receiver: Account) -> u256;

    #[payable]
    #[storage(read)]
    fn swap(asset_in: AssetId, asset_out: AssetId, receiver: Account) -> u64;

    #[payable]
    #[storage(read)]
    fn increase_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        size_delta: u256,
        is_long: bool
    );

    #[storage(read)]
    fn decrease_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account
    ) -> u256;

    #[storage(read)]
    fn liquidate_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        fee_receiver: Account
    );
}