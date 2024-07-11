// SPDX-License-Identifier: Apache-2.0
contract;

/*
 _____ _                  ____  _     _        _ _           _ 
|_   _(_)_ __ ___   ___  |  _ \(_)___| |_ _ __(_) |__  _   _| |_ ___  _ __
  | | | | '_ ` _ \ / _ \ | | | | / __| __| '__| | '_ \| | | | __/ _ \| '__|
  | | | | | | | | |  __/ | |_| | \__ \ |_| |  | | |_) | |_| | || (_) | |
  |_| |_|_| |_| |_|\___| |____/|_|___/\__|_|  |_|_.__/ \__,_|\__\___/|_|
*/

mod events;
mod errors;

use std::{
    asset::mint_to,
    context::*,
    block::timestamp,
    revert::require,
    storage::{
        storage_string::*,
        storage_vec::*,
    },
    string::String
};
use std::hash::*;
use helpers::{
    context::*, 
    utils::*, 
    transfer::*
};
use asset_interfaces::time_distributor::TimeDistributor;
use errors::*;
use events::*;

const DISTRIBUTION_INTERVAL: u64 = 3600; // 1 hour

storage {
    gov: Account = ZERO_ACCOUNT,
    admin: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    
    reward_assets: StorageMap<Account, AssetId> = StorageMap::<Account, AssetId> {},
    assets_per_interval: StorageMap<Account, u64> = StorageMap::<Account, u64> {},
    last_distribution_time: StorageMap<Account, u64> = StorageMap::<Account, u64> {}
}

impl TimeDistributor for Contract {
    #[storage(read, write)]
    fn initialize() {
        require(
            !storage.is_initialized.read(), 
            Error::TimeDistributorAlreadyInitialized
        );

        storage.is_initialized.write(true);

        storage.gov.write(get_sender());
        storage.admin.write(get_sender());
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
    fn set_assets_per_interval(
        receiver: Account,
        amount: u64
    ) {
        _only_admin();

        if storage.last_distribution_time.get(receiver).try_read().unwrap_or(0) == 0 {
            let intervals = _get_intervals(receiver);
            require(
                intervals == 0,
                Error::TimeDistributorPendingDistribution
            )
        }

        storage.assets_per_interval.insert(receiver, amount);
        _update_last_distribution_time(receiver);

        log(AssetsPerIntervalChange { receiver, amount });
    }

    #[storage(read, write)]
    fn update_last_distribution_time(receiver: Account) {
        _only_admin();
        _update_last_distribution_time(receiver);
    }

    #[storage(read, write)]
    fn set_distribution(
        receivers: Vec<Account>,
        amounts: Vec<u64>,
        reward_assets: Vec<AssetId>
    ) {
        _only_gov();

        require(
            receivers.len() == amounts.len() && amounts.len() == reward_assets.len(),
            Error::TimeDistributorInvalidLen
        );

        let mut i = 0;
        let _receiver = receivers.get(i).unwrap();
        while i < receivers.len() {
            let receiver = receivers.get(i).unwrap();

            // if storage.last_distribution_time.get(receiver).try_read().unwrap_or(0) != 0 {
            //     let intervals = _get_intervals(receiver);
            //     require(
            //         intervals == 0,
            //         Error::TimeDistributorPendingDistribution
            //     )
            // }

            let amount = amounts.get(i).unwrap();
            let reward_asset = reward_assets.get(i).unwrap();

            storage.assets_per_interval.insert(receiver, amount);
            storage.reward_assets.insert(receiver, reward_asset);
            // _update_last_distribution_time(receiver);

            // log(DistributionChange {
            //     receiver,
            //     amount,
            //     reward_asset
            // });

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
    #[storage(read)]
    fn get_intervals(receiver: Account) -> u64 {
        _get_intervals(receiver)
    }

    #[storage(read)]
    fn get_assets_per_interval(account: Account) -> u64 {
        storage.assets_per_interval.get(account).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_reward_asset(receiver: Account) -> AssetId {
        storage.reward_assets.get(receiver).try_read().unwrap_or(ZERO_ASSET)
    }

    #[storage(read)]
    fn get_distribution_amount(receiver: Account) -> u64 {
        _get_distribution_amount(receiver)
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn distribute() -> u64 {
        let receiver = get_sender();
        let intervals = _get_intervals(receiver);

        if intervals == 0 { return 0; }

        let amount = _get_distribution_amount(receiver);
        _update_last_distribution_time(receiver);

        if amount == 0 { return 0; }

        transfer_assets(
            // we want this to intentionally revert if there are no reward assets set for the receiver
            storage.reward_assets.get(receiver).read(),
            receiver,
            amount
        );

        log(Distribute { receiver, amount  });

        amount
    }
}

#[storage(read)]
fn _only_gov() {
    require(
        get_sender() == storage.gov.read(),
        Error::TimeDistributorForbidden
    );
}

#[storage(read)]
fn _only_admin() {
    require(
        get_sender() == storage.admin.read(),
        Error::TimeDistributorForbidden
    );
}

#[storage(read)]
fn _get_intervals(account: Account) -> u64 {
    let time_diff = timestamp() - storage.last_distribution_time.get(account).try_read().unwrap_or(0);
    time_diff / DISTRIBUTION_INTERVAL
}

#[storage(read, write)]
fn _update_last_distribution_time(receiver: Account) {
    storage.last_distribution_time.insert(
        receiver, 
        timestamp() / DISTRIBUTION_INTERVAL * DISTRIBUTION_INTERVAL
    );
}

#[storage(read)]
fn _get_distribution_amount(account: Account) -> u64 {
    let assets_per_interval = storage.assets_per_interval
        .get(account).try_read().unwrap_or(0);
    if assets_per_interval == 0 {
        return 0;
    }

    let intervals = _get_intervals(account);
    let amount = assets_per_interval * intervals;

    let balance = balance_of(
        ContractId::this(),
        // we want this to intentionally revert if there are no reward assets set for the account
        storage.reward_assets.get(account).read(),
    );

    if balance < amount {
        return 0;
    }

    amount
}