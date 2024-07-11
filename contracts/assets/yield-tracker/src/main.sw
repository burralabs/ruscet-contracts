// SPDX-License-Identifier: Apache-2.0
contract;

/*
__   ___      _     _   _____               _             
\ \ / (_) ___| | __| | |_   _| __ __ _  ___| | _____ _ __ 
 \ V /| |/ _ \ |/ _` |   | || '__/ _` |/ __| |/ / _ \ '__|
  | | | |  __/ | (_| |   | || | | (_| | (__|   <  __/ |   
  |_| |_|\___|_|\__,_|   |_||_|  \__,_|\___|_|\_\___|_|
*/

mod errors;

use std::{
    asset::mint_to,
    context::*,
    revert::require,
    storage::{
        storage_string::*,
        storage_vec::*,
    },
    primitive_conversions::u64::*,
    string::String
};
use std::hash::*;
use helpers::{
    math::*,
    zero::*,
    context::*, 
    utils::*, 
    transfer::*
};
use asset_interfaces::{
    yield_tracker::YieldTracker,
    yield_asset::YieldAsset,
    time_distributor::TimeDistributor,
};
use errors::*;

const PRECISION: u256 = 0xC9F2C9CD04674EDEA40000000u256; // 10 ** 30;

storage {
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    
    yield_asset: ContractId = ZERO_CONTRACT,
    time_distributor: ContractId = ZERO_CONTRACT,

    cumulative_reward_per_asset: u256 = 0,

    claimable_reward: StorageMap<Account, u256> = StorageMap::<Account, u256> {},
    previous_cumulated_reward_per_asset: StorageMap<Account, u256> = StorageMap::<Account, u256> {}
}

impl YieldTracker for Contract {
    #[storage(read, write)]
    fn initialize(yield_asset: ContractId) {
        require(
            !storage.is_initialized.read(), 
            Error::YieldTrackerAlreadyInitialized
        );
        storage.is_initialized.write(true);

        storage.gov.write(get_sender());
        storage.yield_asset.write(yield_asset);
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
    fn set_time_distributor(time_distributor: ContractId) {
        _only_gov();
        storage.time_distributor.write(time_distributor);
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_assets_per_interval() -> u64 {
        abi(
            TimeDistributor, 
            storage.time_distributor.read().into()
        ).get_assets_per_interval(Account::from(ContractId::this()))  
    }

    #[storage(read)]
    fn claimable(account: Account) -> u256 {
        let yield_asset = abi(YieldAsset, storage.yield_asset.read().into());
        let time_distributor = abi(TimeDistributor, storage.time_distributor.read().into());

        let staked_balance = yield_asset.staked_balance_of(account).as_u256();
        if staked_balance == 0 {
            return storage.claimable_reward.get(account).try_read().unwrap_or(0);
        }

        let pending_rewards = time_distributor.get_distribution_amount(Account::from(ContractId::this())).as_u256() * PRECISION;
        let total_staked = yield_asset.total_staked().as_u256();
        let next_cumulative_reward_per_asset = 
            storage.cumulative_reward_per_asset.read() + (pending_rewards / total_staked);

        storage.claimable_reward.get(account).try_read().unwrap_or(0) + (
            staked_balance.mul(
                next_cumulative_reward_per_asset - 
                storage.previous_cumulated_reward_per_asset.get(account).try_read().unwrap_or(0)
            )/ PRECISION
        )
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn update_rewards(account: Account) {
        _update_rewards(account);
    }

    #[storage(read, write)]
    fn claim(
        account: Account,
        receiver: Account
    ) -> u256 {
        require(
            get_contract_or_revert() == storage.yield_asset.read(),
            Error::YieldTrackerForbidden
        );

        _update_rewards(account);

        let asset_amount = storage.claimable_reward.get(account).try_read().unwrap_or(0);
        storage.claimable_reward.insert(account, 0);

        let reward_asset = abi(
            TimeDistributor, 
            storage.time_distributor.read().into()
        ).get_reward_asset(Account::from(ContractId::this()));
        
        transfer_assets(
            reward_asset,
            receiver,
            // @TODO: potential revert here
            u64::try_from(asset_amount).unwrap()
        );

        asset_amount
    }
}

#[storage(read)]
fn _only_gov() {
    require(
        get_sender() == storage.gov.read(),
        Error::YieldTrackerForbidden
    );
}

#[storage(read, write)]
fn _update_rewards(account: Account) {
    let yield_asset = abi(YieldAsset, storage.yield_asset.read().into());
    let mut block_reward: u256 = 0;

    if storage.time_distributor.read().non_zero() {
        block_reward = abi(
            TimeDistributor, 
            storage.time_distributor.read().into()
        ).distribute().as_u256();
    }

    let mut cumulative_reward_per_asset = storage.cumulative_reward_per_asset.read();
    let total_staked = yield_asset.total_staked().as_u256();

    // only update cumulativeRewardPerToken when there are stakers, i.e. when totalStaked > 0
    // if blockReward == 0, then there will be no change to cumulativeRewardPerToken
    if total_staked > 0 && block_reward > 0 {
        cumulative_reward_per_asset = cumulative_reward_per_asset + (block_reward * PRECISION / total_staked);
        storage.cumulative_reward_per_asset.write(cumulative_reward_per_asset);
    }

    // cumulativeRewardPerToken can only increase
    // so if cumulativeRewardPerToken is zero, it means there are no rewards yet
    if cumulative_reward_per_asset == 0 {
        return;
    }

    if account != ZERO_ACCOUNT {
        let staked_balance = yield_asset.staked_balance_of(account).as_u256();
        let previous_cumulated_reward = storage.previous_cumulated_reward_per_asset.get(account).try_read().unwrap_or(0);

        let claimable_reward: u256 = storage.claimable_reward.get(account).try_read().unwrap_or(0) +
            ((staked_balance * (cumulative_reward_per_asset - previous_cumulated_reward)) / PRECISION);
        
        storage.claimable_reward.insert(account, claimable_reward);
        storage.previous_cumulated_reward_per_asset.insert(account, cumulative_reward_per_asset);
    }
}