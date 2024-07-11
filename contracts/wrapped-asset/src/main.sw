// SPDX-License-Identifier: Apache-2.0
contract;

/*
    __        __                              _    _                 _   
    \ \      / / __ __ _ _ __  _ __   ___  __| |  / \   ___ ___  ___| |_ 
     \ \ /\ / / '__/ _` | '_ \| '_ \ / _ \/ _` | / _ \ / __/ __|/ _ \ __|
      \ V  V /| | | (_| | |_) | |_) |  __/ (_| |/ ___ \\__ \__ \  __/ |_ 
       \_/\_/ |_|  \__,_| .__/| .__/ \___|\__,_/_/   \_\___/___/\___|\__|
                        |_|   |_|                                        

    `WrappedAsset` exists because, while Fuel's native assets are awesome, the FuelVM doesn't support
    more than one asset in a single call. While this may suffice for many use cases, it's not enough
    for more complex applications (like Ruscet) where multiple native assets need to be moved and 
    transferred from a user in a single call (otherwise accounting becomes damn near impossible, and
    can lead to a lot of bugs).

    While it breaks our hearts to have to do this, we're going to have to go with this approach until
    the FuelVM supports the sending of multiple native assets in a single call.

    `WrappedAsset` is similar to how `WETH` is implemented on Ethereum.
*/

mod errors;

use std::{
    context::*,
    revert::require,
    storage::storage_string::*,
    call_frames::*,
    string::String
};
use std::hash::*;
use std::primitive_conversions::str::*;
use helpers::{
    zero::*, 
    context::*, 
    utils::*, 
    transfer::*
};
use interfaces::wrapped_asset::WrappedAsset;
use errors::*;

storage {
    is_initialized: bool = false,
    asset: AssetId = ZERO_ASSET, // the underlying asset
    name: StorageString = StorageString {},
    symbol: StorageString = StorageString {},
    decimals: u8 = 8,
    balances: StorageMap<Account, u64> = StorageMap::<Account, u64> {},
    allowances: StorageMap<Account, StorageMap<Account, u64>> 
        = StorageMap::<Account, StorageMap<Account, u64>> {}
}

impl WrappedAsset for Contract {
    #[storage(read, write)]
    fn initialize(
        asset: AssetId,
        name: String,
        symbol: String,
        decimals: u8
    ) {
        require(
            !storage.is_initialized.read(), 
            Error::WrappedAssetAlreadyInitialized
        );
        require(
            asset.non_zero(), 
            Error::WrappedAssetZeroAsset
        );

        storage.is_initialized.write(true);

        storage.asset.write(asset);
        storage.name.write_slice(name);
        storage.symbol.write_slice(symbol);
        storage.decimals.write(decimals);
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn name() -> Option<String> {
        storage.name.read_slice()
    }

    #[storage(read)]
    fn symbol() -> Option<String> {
        storage.symbol.read_slice()
    }

    #[storage(read)]
    fn decimals() -> u8 {
        storage.decimals.read()
    }

    /// # Information
    /// `balance_of` only returns the amount of the wrapped asset that the user has, 
    /// NOT the amount of actual underlying native asset that the user has
    #[storage(read)]
    fn balance_of(who: Account) -> u64 {
        storage.balances.get(who).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn allowance(
        who: Account,
        spender: Account
    ) -> u64 {
        storage.allowances.get(who).get(spender).try_read().unwrap_or(0)
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[payable]
    #[storage(read, write)]
    fn deposit() {
        require(
            msg_asset_id() == storage.asset.read(),
            Error::WrappedAssetInvalidAsset
        );
        let sender = get_sender();
        let sender_balance = storage.balances.get(sender).try_read().unwrap_or(0);
        storage.balances.get(sender).write(sender_balance + msg_amount());
    }

    #[storage(read, write)]
    fn withdraw(amount: u64) {
        let sender = get_sender();
        let sender_balance = storage.balances.get(sender).try_read().unwrap_or(0);
        require(sender_balance >= amount, Error::WrappedAssetInsufficientBalance);
        storage.balances.get(sender).write(sender_balance - amount);

        transfer_assets(
            storage.asset.read(),
            sender, 
            amount
        );
    }

    #[storage(read, write)]
    fn approve(spender: Account, amount: u64) {
        storage.allowances.get(get_sender()).insert(spender, amount);
    }

    #[payable]
    #[storage(read, write)]
    fn transfer(
        to: Account,
        amount: u64
    ) {
        let sender = get_sender();
        let sender_balance = storage.balances.get(sender).try_read().unwrap_or(0);
        require(sender_balance >= amount, Error::WrappedAssetInsufficientBalance);

        storage.balances.get(sender).write(sender_balance - amount);
        storage.balances.get(to).write(
            storage.balances.get(to).try_read().unwrap_or(0) + amount
        );
    }

    #[storage(read, write)]
    fn transfer_on_behalf_of(
        who: Account,
        to: Account,
        amount: u64,
    ) {
        let sender = get_sender();
        let sender_allowance = storage.allowances.get(who).get(sender).try_read().unwrap_or(0);
        require(sender_allowance >= amount, Error::WrappedAssetInsufficientAllowance);

        storage.allowances.get(who).get(sender).write(sender_allowance - amount);

        let who_balance = storage.balances.get(who).try_read().unwrap_or(0);
        require(who_balance >= amount, Error::WrappedAssetInsufficientBalance);

        storage.balances.get(who).write(who_balance - amount);
        storage.balances.get(to).write(
            storage.balances.get(to).try_read().unwrap_or(0) + amount
        );
    }
}
