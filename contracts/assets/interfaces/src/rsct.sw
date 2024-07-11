// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    string::String,
};

use helpers::{
    context::Account,
};

abi RSCT {
    #[storage(read, write)]
    fn initialize();

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
    fn set_minter(minter: Account, is_active: bool);

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    fn get_id() -> AssetId;

    #[storage(read)]
    fn id() -> String;

    #[storage(read)]
    fn name() -> String;

    #[storage(read)]
    fn symbol() -> String;

    #[storage(read)]
    fn decimals() -> u8;

    #[storage(read)]
    fn total_supply() -> u64;

    #[storage(read)]
    fn balance_of(who: Account) -> u64;

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

    #[storage(read, write)]
    fn mint(account: Account, amount: u64);

    #[payable]
    #[storage(read, write)]
    fn burn(account: Account, amount: u64);
}