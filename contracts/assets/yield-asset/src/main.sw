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
    string::String,
    b512::B512,
	ecr::ec_recover_address,
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
    non_staking_accounts: StorageMap<Account, bool> = StorageMap {},
    admins: StorageMap<Account, bool> = StorageMap {},

    staked_balance_handler: Address = ZERO_ADDRESS,
    user_staked_balance: StorageMap<Account, u64> = StorageMap {},
}

struct SetStakedBalanceHandler {
    pub staked_balance_handler: Address
}

struct Message {
	account: Account,
	balance: u64,
}

impl Hash for Message {
    fn hash(self, ref mut state: Hasher) {
        self.account.hash(state);
        self.balance.hash(state);
    }
}

impl YieldAsset for Contract {
    #[storage(read, write)]
    fn initialize(
        name: String,
        symbol: String,
        initial_supply: u64,
        staked_balance_handler: Address,
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
        _mint(get_sender(), initial_supply);

        // handler is responsible for updating the user's staked balance
        // different from `gov` because this is a hot wallet solely for the purposes of signing staked balance updates
        // if this handler is compromised, it would lead to incorrect rewards calculations which over time could
        // add up, but are insignificant in the short term
        // rather than having `gov` to be a hot wallet to sign messages on the go which increases the potential attack surface
        storage.staked_balance_handler.write(staked_balance_handler);
        log(SetStakedBalanceHandler { staked_balance_handler });
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
    fn set_staked_balance_handler(staked_balance_handler: Address) {
        _only_gov();

        storage.staked_balance_handler.write(staked_balance_handler);
        log(SetStakedBalanceHandler { staked_balance_handler });
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
    fn add_nonstaking_account(account: Account) {
        _only_admin();
        require(
            !storage.non_staking_accounts.get(account).try_read().unwrap_or(false),
            Error::YieldAssetAccountNotMarked
        );

        _update_rewards(account);
        storage.non_staking_accounts.insert(account, true);
    }

    #[storage(read, write)]
    fn remove_nonstaking_account(account: Account) {
        _only_admin();
        require(
            storage.non_staking_accounts.get(account).try_read().unwrap_or(false),
            Error::YieldAssetAccountNotMarked
        );

        _update_rewards(account);
        storage.non_staking_accounts.remove(account);
    }

    #[storage(read)]
    fn recover_claim(
        account: Account,
        receiver: Account,
    ) {
        _only_admin();
        let mut i = 0;
        let len = storage.yield_trackers.len();

        let staked_balance = _get_user_staked_balance(account);

        while i < len {
            let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
            abi(YieldTracker, yield_tracker.into()).claim(account, receiver, staked_balance);
            i += 1;
        }
    }

    #[storage(read)]
    fn claim(receiver: Account) {
        _only_admin();
        let mut i = 0;
        let len = storage.yield_trackers.len();

        let staked_balance = _get_user_staked_balance(get_sender());

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

/*
    ____  ___       _                        _ 
   / / / |_ _|_ __ | |_ ___ _ __ _ __   __ _| |
  / / /   | || '_ \| __/ _ \ '__| '_ \ / _` | |
 / / /    | || | | | ||  __/ |  | | | | (_| | |
/_/_/    |___|_| |_|\__\___|_|  |_| |_|\__,_|_|
*/
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
fn _verify_signature(
    account: Account,
    amount: u64,
    signature: B512
) {
    let msg_hash = sha256(Message { account, balance: amount });
    let recovered_address: b256 = ec_recover_address(signature, msg_hash).unwrap().bits();

    require(
        recovered_address == storage.staked_balance_handler.read().bits(),
        Error::YieldAssetInvalidSignature
    );
}

#[storage(read)]
fn _get_user_staked_balance(account: Account) -> u256 {
    storage.user_staked_balance.get(account).try_read().unwrap_or(0).as_u256()
}

#[storage(read, write)]
fn _mint(
    account: Account,
    amount: u64,
) {
    require(account != ZERO_ACCOUNT, Error::YieldAssetMintToZeroAccount);

    _update_rewards(account);

    storage.total_supply.write(storage.total_supply.read() + amount);

    let identity = account_to_identity(account);

    // sub-id: ZERO_B256
    mint_to(identity, ZERO, amount);
}

#[storage(read)]
fn _update_rewards(account: Account) {
    let mut i = 0;
    let len = storage.yield_trackers.len();

    let staked_balance = _get_user_staked_balance(account);

    while i < len {
        let yield_tracker = storage.yield_trackers.get(i).unwrap().read();
        abi(YieldTracker, yield_tracker.into()).update_rewards(account, staked_balance);
        i += 1;
    }
}