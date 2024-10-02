// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____  _   _ ____  ____           __   ___      _     _      _                 _   
|  _ \| | | / ___||  _ \          \ \ / (_) ___| | __| |    / \   ___ ___  ___| |_ 
| |_) | | | \___ \| | | |  _____   \ V /| |/ _ \ |/ _` |   / _ \ / __/ __|/ _ \ __|
|  _ <| |_| |___) | |_| | |_____|   | | | |  __/ | (_| |  / ___ \\__ \__ \  __/ |_ 
|_| \_\\___/|____/|____/            |_| |_|\___|_|\__,_| /_/   \_\___/___/\___|\__|
                                                                                   
    RUSD "inherits" YieldAsset in its most basic form, with additional methods
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
    call_frames::msg_asset_id,
    string::String
};
use std::hash::*;
use helpers::{
    context::*, 
    utils::*, 
    transfer::*,
    zero::*,
};
use asset_interfaces::{
    rusd::RUSD,
    yield_tracker::YieldTracker
};
use errors::*;

storage {
    /*
       __   ___      _     _      _                 _   
       \ \ / (_) ___| | __| |    / \   ___ ___  ___| |_ 
        \ V /| |/ _ \ |/ _` |   / _ \ / __/ __|/ _ \ __|
         | | | |  __/ | (_| |  / ___ \\__ \__ \  __/ |_ 
         |_| |_|\___|_|\__,_| /_/   \_\___/___/\___|\__|   
    */
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

    vaults: StorageMap<ContractId, bool> = StorageMap::<ContractId, bool> {},
}

impl RUSD for Contract {
    #[storage(read, write)]
    fn initialize(vault: ContractId) {
        require(
            !storage.is_initialized.read(), 
            Error::YieldAssetAlreadyInitialized
        );
        storage.is_initialized.write(true);

        storage.name.write_slice(String::from_ascii_str("RUSD"));
        storage.symbol.write_slice(String::from_ascii_str("RUSD"));
        
        storage.gov.write(get_sender());
        storage.admins.insert(get_sender(), true);
        storage.vaults.insert(vault, true);
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

        let len = yield_trackers.len();
        while i < len {
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
    fn add_vault(vault: ContractId) {
        _only_gov();
        storage.vaults.insert(vault, true);
    }

    #[storage(read, write)]
    fn remove_vault(vault: ContractId) {
        _only_gov();
        storage.vaults.remove(vault);
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
    fn add_nonstaking_account(account: Account, staked_balance: u256) {
        _only_admin();
        require(
            !storage.non_staking_accounts.get(account).try_read().unwrap_or(false),
            Error::YieldAssetAccountNotMarked
        );

        _update_rewards(account, staked_balance);
        storage.non_staking_accounts.insert(account, true);
    }

    #[storage(read, write)]
    fn remove_nonstaking_account(account: Account, staked_balance: u256) {
        _only_admin();
        require(
            storage.non_staking_accounts.get(account).try_read().unwrap_or(false),
            Error::YieldAssetAccountNotMarked
        );

        _update_rewards(account, staked_balance);
        storage.non_staking_accounts.remove(account);
    }

    #[storage(read)]
    fn recover_claim(account: Account, receiver: Account, staked_balance: u256) {
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
    fn claim(receiver: Account, staked_balance: u256) {
        _only_admin();
        let mut i = 0;
        let len = storage.yield_trackers.len();

        while i < len {
            let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
            abi(YieldTracker, yield_tracker.into()).claim(get_sender(), receiver, staked_balance);
            i += 1;
        }
    }

    #[storage(read, write)]
    fn mint(account: Account, amount: u64, staked_balance: u256) {
        _only_vault();
        _mint(account, amount, staked_balance);
    }

    #[payable]
    #[storage(read, write)]
    fn burn(account: Account, amount: u64, staked_balance: u256) {
        _only_vault();
        _burn(account, amount, staked_balance);
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
    fn total_supply() -> u64 {
        storage.total_supply.read()
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

#[storage(read)]
fn _only_vault() {
    require(
        storage.vaults.get(get_contract_or_revert()).try_read().unwrap_or(false),
        Error::RUSDForbidden
    );
}

#[storage(read, write)]
fn _mint(
    account: Account,
    amount: u64,
    // staked balance of the account
    staked_balance: u256
) {
    require(account.non_zero(), Error::YieldAssetMintToZeroAccount);

    _update_rewards(account, staked_balance);

    storage.total_supply.write(storage.total_supply.read() + amount);

    let identity = account_to_identity(account);

    // sub-id: ZERO_B256
    mint_to(identity, ZERO, amount);
}

#[storage(read, write)]
fn _burn(
    account: Account,
    amount: u64,
    // staked balance of the account
    staked_balance: u256
) {
    require(account.non_zero(), Error::YieldAssetBurnFromZeroAccount);
    require(
        msg_asset_id() == AssetId::new(ContractId::this(), ZERO),
        Error::YieldAssetInvalidBurnAssetForwarded
    );
    require(
        msg_amount() == amount,
        Error::YieldAssetInvalidBurnAmountForwarded
    );

    _update_rewards(account, staked_balance);

    storage.total_supply.write(storage.total_supply.read() - amount);

    burn(ZERO, amount);
}

#[storage(read)]
fn _update_rewards(account: Account, staked_balance: u256) {
    let mut i = 0;
    let len = storage.yield_trackers.len();

    while i < len {
        let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
        abi(YieldTracker, yield_tracker.into()).update_rewards(account, staked_balance);
        i += 1;
    }
}