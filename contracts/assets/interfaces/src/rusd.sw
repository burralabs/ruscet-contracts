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
    fn set_info(
        name: String,
        symbol: String
    );

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
    fn add_nonstaking_account(account: Account);

    #[storage(read, write)]
    fn remove_nonstaking_account(account: Account);

    #[storage(read)]
    fn recover_claim(account: Account, receiver: Account);

    #[storage(read)]
    fn claim(receiver: Account);

    #[storage(read, write)]
    fn mint(account: Account, amount: u64);

    #[payable]
    #[storage(read, write)]
    fn burn(account: Account, amount: u64);

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
    fn balance_of(who: Account) -> u64;

    #[storage(read)]
    fn staked_balance_of(who: Account) -> u64;

    #[storage(read)]
    fn allowance(
        who: Account,
        spender: Account
    ) -> u64;

    #[storage(read)]
    fn total_supply() -> u64;
    
    #[storage(read)]
    fn total_staked() -> u64;

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn approve(spender: Account, amount: u64) -> bool;

    #[payable]
    #[storage(read, write)]
    fn transfer(
        to: Account,
        amount: u64
    ) -> bool;

    #[storage(read, write)]
    fn transfer_on_behalf_of(
        who: Account,
        to: Account,
        amount: u64,
    ) -> bool;
}