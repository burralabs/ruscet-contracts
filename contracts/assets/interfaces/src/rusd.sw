// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    string::String,
    b512::B512
};

use helpers::{
    context::Account,
};

abi RUSD {
    #[storage(read, write)]
    fn initialize(
        vault_router: ContractId,
        staked_balance_handler: Address
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
    fn set_staked_balance_handler(staked_balance_handler: Address);

    #[storage(read, write)]
    fn set_yield_trackers(yield_trackers: Vec<ContractId>);

    #[storage(read, write)]
    fn add_admin(account: Account);

    #[storage(read, write)]
    fn remove_admin(account: Account);

    #[storage(read, write)]
    fn add_vault(vault_router: ContractId);

    #[storage(read, write)]
    fn remove_vault(vault_router: ContractId);

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
    fn set_user_staked_balance(
        account: Account,
        amount: u64,
        signature: B512
    );
}