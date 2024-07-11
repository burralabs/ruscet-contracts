// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    string::String,
};

use helpers::{
    context::Account,
};

abi WrappedAsset {
    #[storage(read, write)]
    fn initialize(
        asset: AssetId,
        name: String,
        symbol: String,
        decimals: u8
    );

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn name() -> Option<String>;

    #[storage(read)]
    fn symbol() -> Option<String>;

    #[storage(read)]
    fn decimals() -> u8;

    /// # Information
    /// `balance_of` only returns the amount of the wrapped asset that the user has, NOT the amount
    /// of actual underlying native asset that the user has
    #[storage(read)]
    fn balance_of(who: Account) -> u64;

    #[storage(read)]
    fn allowance(
        who: Account,
        spender: Account
    ) -> u64;

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[payable]
    #[storage(read, write)]
    fn deposit();

    #[storage(read, write)]
    fn withdraw(amount: u64);

    #[storage(read, write)]
    fn approve(spender: Account, amount: u64);

    #[payable]
    #[storage(read, write)]
    fn transfer(
        to: Account,
        amount: u64
    );

    #[storage(read, write)]
    fn transfer_on_behalf_of(
        who: Account,
        to: Account,
        amount: u64,
    );
}