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

    balances: StorageMap<Account, u64> = StorageMap::<Account, u64> {},
    allowances: StorageMap<Account, StorageMap<Account, u64>> 
        = StorageMap::<Account, StorageMap<Account, u64>> {},
    total_supply: u64 = 0,
    non_staking_supply: u64 = 0,

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

        storage.name.write_slice(String::from_ascii_str("USD Gambit"));
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
    fn set_info(
        name: String,
        symbol: String
    ) {
        _only_gov();
        storage.name.write_slice(name);
        storage.symbol.write_slice(symbol);
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
    fn add_nonstaking_account(account: Account) {
        _only_admin();
        require(
            !storage.non_staking_accounts.get(account).try_read().unwrap_or(false),
            Error::YieldAssetAccountNotMarked
        );

        _update_rewards(account);
        storage.non_staking_accounts.insert(account, true);
        storage.non_staking_supply.write(
            storage.non_staking_supply.read() + storage.balances.get(account).try_read().unwrap_or(0)
        );
    }

    #[storage(read, write)]
    fn remove_nonstaking_account(account: Account) {
        _only_admin();
        require(
            storage.non_staking_accounts.get(account).try_read().unwrap_or(false),
            Error::YieldAssetAccountNotMarked
        );

        _update_rewards(account);
        storage.non_staking_accounts.insert(account, false);
        storage.non_staking_supply.write(
            storage.non_staking_supply.read() - storage.balances.get(account).try_read().unwrap_or(0)
        );
    }

    #[storage(read)]
    fn recover_claim(account: Account, receiver: Account) {
        _only_admin();
        let mut i = 0;
        while i < storage.yield_trackers.len() {
            let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
            abi(YieldTracker, yield_tracker.into()).claim(account, receiver);
            i += 1;
        }
    }

    #[storage(read)]
    fn claim(receiver: Account) {
        _only_admin();
        let mut i = 0;
        while i < storage.yield_trackers.len() {
            let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
            abi(YieldTracker, yield_tracker.into()).claim(get_sender(), receiver);
            i += 1;
        }
    }

    #[storage(read, write)]
    fn mint(account: Account, amount: u64) {
        _only_vault();
        _mint(account, amount);
    }

    #[payable]
    #[storage(read, write)]
    fn burn(account: Account, amount: u64) {
        _only_vault();
        _burn(account, amount);
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
    fn balance_of(who: Account) -> u64 {
        storage.balances.get(who).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn staked_balance_of(who: Account) -> u64 {
        if storage.non_staking_accounts.get(who).try_read().unwrap_or(false) {
            return 0;
        }

        storage.balances.get(who).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn allowance(
        who: Account,
        spender: Account
    ) -> u64 {
        storage.allowances.get(who).get(spender).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn total_supply() -> u64 {
        storage.total_supply.read()
    }

    #[storage(read)]
    fn total_staked() -> u64 {
        storage.total_supply.read() - storage.non_staking_supply.read()
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn approve(spender: Account, amount: u64) -> bool {
        _approve(get_sender(), spender, amount);
        true
    }

    #[payable]
    #[storage(read, write)]
    fn transfer(
        to: Account,
        amount: u64
    ) -> bool {
        _transfer(get_sender(), to, amount);
        true
    }

    #[storage(read, write)]
    fn transfer_on_behalf_of(
        who: Account,
        to: Account,
        amount: u64,
    ) -> bool {
        let sender_allowance = storage.allowances.get(who).get(get_sender()).try_read().unwrap_or(0);
        require(sender_allowance >= amount, Error::YieldAssetInsufficientAllowance);

        _approve(who, get_sender(), sender_allowance - amount);
        _transfer(who, to, amount);

        true
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
    amount: u64
) {
    require(account.non_zero(), Error::YieldAssetMintToZeroAccount);

    _update_rewards(account);

    storage.total_supply.write(storage.total_supply.read() + amount);
    storage.balances.get(account).write(
        storage.balances.get(account).try_read().unwrap_or(0) + amount
    );

    if storage.non_staking_accounts.get(account).try_read().unwrap_or(false) {
        storage.non_staking_supply.write(
            storage.non_staking_supply.read() + amount
        );
    }

    let identity = account_to_identity(account);

    // sub-id: ZERO_B256
    mint_to(identity, ZERO, amount);
}

#[storage(read, write)]
fn _burn(
    account: Account,
    amount: u64
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

    _update_rewards(account);

    let account_balance = storage.balances.get(account).try_read().unwrap_or(0);
    require(account_balance >= amount, Error::YieldAssetBurnAmountExceedsBalance);

    storage.balances.get(account).write(account_balance - amount);
    storage.total_supply.write(storage.total_supply.read() - amount);

    if storage.non_staking_accounts.get(account).try_read().unwrap_or(false) {
        storage.non_staking_supply.write(
            storage.non_staking_supply.read() - amount
        );
    }
    
    burn(ZERO, amount);
}

#[storage(read, write)]
fn _transfer(
    sender: Account,
    recipient: Account,
    amount: u64
) {
    require(sender.non_zero(), Error::YieldAssetTransferFromZeroAccount);
    require(recipient.non_zero(), Error::YieldAssetTransferToZeroAccount);

    require(
        amount == msg_amount(),
        Error::YieldAssetInsufficientTransferAmountForwarded
    );

    if storage.in_whitelist_mode.read() {
        require(
            storage.whitelisted_handlers.get(get_sender()).try_read().unwrap_or(false),
            Error::YieldAssetMsgSenderNotWhitelisted
        );
    }

    _update_rewards(sender);
    _update_rewards(recipient);

    let sender_balance = storage.balances.get(sender).try_read().unwrap_or(0);
    require(sender_balance >= amount, Error::YieldAssetInsufficientBalance);

    storage.balances.get(sender).write(sender_balance - amount);
    storage.balances.get(recipient).write(
        storage.balances.get(recipient).try_read().unwrap_or(0) + amount
    );

    if storage.non_staking_accounts.get(sender).try_read().unwrap_or(false) {
        storage.non_staking_supply.write(
            storage.non_staking_supply.read() - amount
        );
    }

    if storage.non_staking_accounts.get(recipient).try_read().unwrap_or(false) {
        storage.non_staking_supply.write(
            storage.non_staking_supply.read() - amount
        );
    }

    transfer_assets(
        msg_asset_id(),
        recipient,
        amount
    );
}

#[storage(read, write)]
fn _approve(
    owner: Account,
    spender: Account, 
    amount: u64
) {
    require(owner.non_zero(), Error::YieldAssetApproveFromZeroAccount);
    require(spender.non_zero(), Error::YieldAssetApproveToZeroAccount);

    storage.allowances.get(get_sender()).insert(spender, amount);
}

#[storage(read)]
fn _update_rewards(account: Account) {
    let mut i = 0;
    while i < storage.yield_trackers.len() {
        let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
        abi(YieldTracker, yield_tracker.into()).update_rewards(account);
        i += 1;
    }
}