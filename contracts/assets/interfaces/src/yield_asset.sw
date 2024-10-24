// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    string::String,
};

use helpers::{
    context::Account,
};

abi YieldAsset {
    #[storage(read, write)]
    fn initialize(
        name: String,
        symbol: String,
        initial_supply: u64,
        staked_balance_handler: Address,
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
    fn add_nonstaking_account(account: Account);

    #[storage(read, write)]
    fn remove_nonstaking_account(account: Account);

    #[storage(read)]
    fn recover_claim(
        account: Account,
        receiver: Account,
    );

    #[storage(read)]
    fn claim(receiver: Account);

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
    fn total_staked() -> u64;
}