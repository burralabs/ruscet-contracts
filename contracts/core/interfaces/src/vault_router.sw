// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
};

abi VaultRouter {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault_storage: ContractId,
        vault_utils: ContractId,
        vault: ContractId,
        vault_rusd: ContractId,
        vault_position: ContractId,
    );

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_gov(gov: Account);

    #[storage(read, write)]
    fn set_vault_storage(vault_storage: ContractId);

    #[storage(read, write)]
    fn set_vault_utils(vault_utils: ContractId);

    #[storage(read, write)]
    fn set_vault(vault: ContractId);

    #[storage(read, write)]
    fn set_vault_rusd(vault_rusd: ContractId);

    #[storage(read, write)]
    fn set_vault_position(vault_position: ContractId);

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

    #[storage(read)]
    fn get_vault_rusd() -> ContractId;

    #[storage(read)]
    fn get_vault_position() -> ContractId;

    #[storage(read)]
    fn get_vault() -> ContractId;

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn withdraw_fees(
        asset: AssetId,
        receiver: Account 
    );
    
    #[payable]
    #[storage(read, write)]
    fn direct_pool_deposit(asset: AssetId);

    #[payable]
    #[storage(read, write)]
    fn buy_rusd(asset: AssetId, receiver: Account) -> u256;

    #[payable]
    #[storage(read, write)]
    fn sell_rusd(asset: AssetId, receiver: Account) -> u256;

    #[payable]
    #[storage(read, write)]
    fn swap(asset_in: AssetId, asset_out: AssetId, receiver: Account) -> u64;

    #[payable]
    #[storage(read, write)]
    fn increase_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        size_delta: u256,
        is_long: bool
    );

    #[storage(read, write)]
    fn decrease_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account
    ) -> u256;

    #[storage(read, write)]
    fn liquidate_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        fee_receiver: Account
    );
}