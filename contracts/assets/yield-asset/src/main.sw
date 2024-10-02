// SPDX-License-Identifier: Apache-2.0
contract;

/*
__   ___      _     _      _                 _   
\ \ / (_) ___| | __| |    / \   ___ ___  ___| |_ 
 \ V /| |/ _ \ |/ _` |   / _ \ / __/ __|/ _ \ __|
  | | | |  __/ | (_| |  / ___ \\__ \__ \  __/ |_ 
  |_| |_|\___|_|\__,_| /_/   \_\___/___/\___|\__|    
*/

mod errors;

use std::{
    asset::*,
    context::*,
    revert::require,
    storage::{
        storage_string::*,
        storage_vec::*,
    },
    call_frames::*,
    string::String
};
use std::hash::*;
use helpers::{
    context::*, 
    utils::*, 
    transfer::*
};
use asset_interfaces::{
    yield_asset::YieldAsset,
    yield_tracker::YieldTracker
};
use errors::*;

storage {
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    
    name: StorageString = StorageString {},
    symbol: StorageString = StorageString {},
    decimals: u8 = 8,

    total_supply: u64 = 0,

    yield_trackers: StorageVec<ContractId> = StorageVec::<ContractId> {},
    non_staking_accounts: StorageMap<Account, bool> = StorageMap::<Account, bool> {},
    admins: StorageMap<Account, bool> = StorageMap::<Account, bool> {},

    in_whitelist_mode: bool = false,
    whitelisted_handlers: StorageMap<Account, bool> = StorageMap::<Account, bool> {},
}

impl YieldAsset for Contract {
    #[storage(read, write)]
    fn initialize(
        name: String,
        symbol: String,
        initial_supply: u64
    ) {
        require(
            !storage.is_initialized.read(), 
            Error::YieldAssetAlreadyInitialized
        );
        storage.is_initialized.write(true);

        storage.name.write_slice(name);
        storage.symbol.write_slice(symbol);
        
        storage.gov.write(get_sender());
        storage.admins.insert(get_sender(), true);
        _mint(get_sender(), initial_supply, 0);
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_gov(new_gov: Account) {
        _only_gov();
        storage.gov.write(new_gov);
    }

    #[storage(read, write)]
    fn set_yield_trackers(yield_trackers: Vec<ContractId>) {
        _only_gov();
        storage.yield_trackers.clear();

        let mut i = 0;

        while i < yield_trackers.len() {
            let yield_tracker = yield_trackers.get(i).unwrap();
            storage.yield_trackers.push(yield_tracker);

            i += 1;
        }
    }

    #[storage(read, write)]
    fn add_admin(account: Account) {
        _only_gov();
        storage.admins.insert(account, true);
    }

    #[storage(read, write)]
    fn remove_admin(account: Account) {
        _only_gov();
        storage.admins.remove(account);
    }

    #[storage(read, write)]
    fn set_in_whitelist_mode(in_whitelist_mode: bool) {
        _only_gov();
        storage.in_whitelist_mode.write(in_whitelist_mode);
    }

    #[storage(read, write)]
    fn set_whitelisted_handler(handler: Account, is_whitelisted: bool) {
        _only_gov();
        storage.whitelisted_handlers.insert(handler, is_whitelisted);
    }

    #[storage(read, write)]
    fn add_nonstaking_account(account: Account,
        // staked balance of the account
        staked_balance: u256
    ) {
        _only_admin();
        require(
            !storage.non_staking_accounts.get(account).try_read().unwrap_or(false),
            Error::YieldAssetAccountNotMarked
        );

        _update_rewards(account, staked_balance);
        storage.non_staking_accounts.insert(account, true);
    }

    #[storage(read, write)]
    fn remove_nonstaking_account(
        account: Account,
        // staked balance of the account
        staked_balance: u256
    ) {
        _only_admin();
        require(
            storage.non_staking_accounts.get(account).try_read().unwrap_or(false),
            Error::YieldAssetAccountNotMarked
        );

        _update_rewards(account, staked_balance);
        storage.non_staking_accounts.remove(account);
    }

    #[storage(read)]
    fn recover_claim(
        account: Account,
        receiver: Account,
        // staked balance of the account
        staked_balance: u256
    ) {
        _only_admin();
        let mut i = 0;
        let len = storage.yield_trackers.len();

        while i < len {
            let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
            abi(YieldTracker, yield_tracker.into()).claim(account, receiver, staked_balance);
            i += 1;
        }
    }

    #[storage(read)]
    fn claim(
        receiver: Account,
        // staked balance of the account
        staked_balance: u256
    ) {
        _only_admin();
        let mut i = 0;
        let len = storage.yield_trackers.len();

        while i < len {
            let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
            abi(YieldTracker, yield_tracker.into()).claim(get_sender(), receiver, staked_balance);
            i += 1;
        }
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    fn get_id() -> AssetId {
        AssetId::new(ContractId::this(), ZERO)
    }

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

    #[storage(read)]
    fn total_staked() -> u64 {
        storage.total_supply.read()
    }
}

#[storage(read)]
fn _only_gov() {
    require(
        get_sender() == storage.gov.read(),
        Error::YieldAssetForbidden
    );
}

#[storage(read)]
fn _only_admin() {
    require(
        storage.admins.get(get_sender()).try_read().unwrap_or(false),
        Error::YieldAssetForbidden
    );
}

#[storage(read, write)]
fn _mint(
    account: Account,
    amount: u64,
    // staked balance of the account
    staked_balance: u256,
) {
    require(account != ZERO_ACCOUNT, Error::YieldAssetMintToZeroAccount);

    _update_rewards(account, staked_balance);

    storage.total_supply.write(storage.total_supply.read() + amount);

    let identity = account_to_identity(account);

    // sub-id: ZERO_B256
    mint_to(identity, ZERO, amount);
}

#[storage(read)]
fn _update_rewards(
    account: Account,
    // staked balance of the account
    staked_balance: u256
) {
    let mut i = 0;
    let len = storage.yield_trackers.len();

    while i < len {
        let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
        abi(YieldTracker, yield_tracker.into()).update_rewards(account, staked_balance);
        i += 1;
    }
}