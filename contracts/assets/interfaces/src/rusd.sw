// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    string::String,
};

use helpers::{
    context::Account,
};

abi RUSD {
    #[storage(read, write)]
    fn initialize(vault: ContractId);

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
    fn set_yield_trackers(yield_trackers: Vec<ContractId>);

    #[storage(read, write)]
    fn add_admin(account: Account);

    #[storage(read, write)]
    fn remove_admin(account: Account);

    #[storage(read, write)]
    fn add_vault(vault: ContractId);

    #[storage(read, write)]
    fn remove_vault(vault: ContractId);

    #[storage(read, write)]
    fn set_in_whitelist_mode(in_whitelist_mode: bool);

    #[storage(read, write)]
    fn set_whitelisted_handler(handler: Account, is_whitelisted: bool);

    #[storage(read, write)]
    fn add_nonstaking_account(account: Account, staked_balance: u256);

    #[storage(read, write)]
    fn remove_nonstaking_account(account: Account, staked_balance: u256);

    #[storage(read)]
    fn recover_claim(account: Account, receiver: Account, staked_balance: u256);

    #[storage(read)]
    fn claim(receiver: Account, staked_balance: u256);

    #[storage(read, write)]
    fn mint(account: Account, amount: u64, staked_balance: u256);

    #[payable]
    #[storage(read, write)]
    fn burn(account: Account, amount: u64, staked_balance: u256);

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    fn get_id() -> AssetId;

    #[storage(read)]
    fn name() -> Option<String>;

    #[storage(read)]
    fn symbol() -> Option<String>;

    #[storage(read)]
    fn decimals() -> u8;

    #[storage(read)]
    fn total_supply() -> u64;
    
    #[storage(read)]
    fn total_staked() -> u64;
}