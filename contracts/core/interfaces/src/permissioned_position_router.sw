// SPDX-License-Identifier: Apache-2.0
library;

use std::hash::*;
use helpers::{
    context::*,
    signed_64::*,
    fixed_vec::FixedVecAssetIdSize5,
    utils::*
};

pub struct IncreasePositionRequest {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub amount_in: u64,
    pub min_out: u64,
    pub size_delta: u256,
    pub is_long: bool,
    pub acceptable_price: u256,
    pub execution_fee: u64,
    pub block_height: u32,
    pub block_time: u64,
    pub callback_target: ContractId
}

pub struct DecreasePositionRequest {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub collateral_delta: u256,
    pub size_delta: u256,
    pub is_long: bool,
    pub receiver: Account,
    pub acceptable_price: u256,
    pub min_out: u64,
    pub execution_fee: u64,
    pub block_height: u32,
    pub block_time: u64,
    pub withdraw_eth: bool,
    pub callback_target: ContractId
}

pub struct RequestKey {
    pub account: Account,
    pub index: u64
}

abi PermissionedPositionRouter {
    #[storage(read, write)]
    fn initialize(
        base_position_manager: ContractId,
        vault: ContractId,
        min_execution_fee: u64
    );

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_position_keeper(
        account: Account,
        is_active: bool 
    );

    #[storage(read, write)]
    fn set_callback_gas_limit(callback_gas_limit: u64);

    #[storage(read, write)]
    fn set_custom_callback_gas_limit(
        callback_target: ContractId,
        callback_gas_limit: u64
    );

    #[storage(read, write)]
    fn set_min_execution_fee(min_execution_fee: u64);

    #[storage(read, write)]
    fn set_is_leverage_enabled(is_leverage_enabled: bool);

    #[storage(read, write)]
    fn set_delay_values(
        min_block_delay_keeper: u32,
        min_time_delay_public: u64,
        max_time_delay: u64 
    );

    #[storage(read, write)]
    fn set_request_key_start_values(
        increase_position_request_keys_start: u64,
        decrease_position_request_keys_start: u64
    );

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_base_position_manager() -> ContractId;

    #[storage(read)]
    fn get_asset_balances(asset_id: AssetId) -> u64;

    fn get_request_key(
        account: Account,
        index: u64
    ) -> b256;

    #[storage(read)]
    fn get_increase_position_request(key: b256) -> IncreasePositionRequest;

    #[storage(read)]
    fn get_increase_positions_index(account: Account) -> u64;

    #[storage(read)]
    fn get_increase_position_request_keys(key: u64) -> b256;

    #[storage(read)]
    fn get_increase_position_request_path(key: b256) -> Vec<AssetId>;

    #[storage(read)]
    fn get_decrease_position_request(key: b256) -> DecreasePositionRequest;

    #[storage(read)]
    fn get_decrease_positions_index(account: Account) -> u64;

    #[storage(read)]
    fn get_decrease_position_request_keys(key: u64) -> b256;

    #[storage(read)]
    fn get_decrease_position_request_path(key: b256) -> Vec<AssetId>;

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn execute_increase_positions(
        end_index_: u64,
        execution_fee_receiver: Account
    );

    #[storage(read, write)]
    fn execute_increase_position(
        key: b256,
        execution_fee_receiver: Account
    ) -> bool;

    #[storage(read, write)]
    fn cancel_increase_position(
        key: b256,
        execution_fee_receiver: Account
    ) -> bool;

    #[storage(read, write)]
    fn execute_decrease_positions(
        end_index_: u64,
        execution_fee_receiver: Account
    );

    #[storage(read, write)]
    fn execute_decrease_position(
        key: b256,
        execution_fee_receiver: Account
    ) -> bool;

    #[storage(read, write)]
    fn cancel_decrease_position(
        key: b256,
        execution_fee_receiver: Account
    ) -> bool;

    #[payable]
    #[storage(read, write)]
    fn create_increase_position(
        path: Vec<AssetId>,
        index_asset: AssetId,
        amount_in: u64,
        min_out: u64,
        size_delta: u256,
        is_long: bool,
        acceptable_price: u256,
        execution_fee: u64,
        referral_code: b256,
        callback_target: ContractId
    ) -> b256;

    #[payable]
    #[storage(read, write)]
    fn create_decrease_position(
        path: Vec<AssetId>,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account,
        acceptable_price: u256,
        min_out: u64,
        execution_fee: u64,
        withdraw_eth: bool,
        callback_target: ContractId
    ) -> b256;

    #[storage(read)]
    fn get_request_queue_lengths() -> (u64, u64, u64, u64);
}

impl IncreasePositionRequest {
    pub fn default() -> Self {
        Self {
            account: ZERO_ACCOUNT,
            path: FixedVecAssetIdSize5::default(),
            index_asset: ZERO_ASSET,
            amount_in: 0,
            min_out: 0,
            size_delta: 0,
            is_long: false,
            acceptable_price: 0,
            execution_fee: 0,
            block_height: 0,
            block_time: 0,
            callback_target: ZERO_CONTRACT
        }
    }
}

impl DecreasePositionRequest {
    pub fn default() -> Self {
        Self {
            account: ZERO_ACCOUNT,
            path: FixedVecAssetIdSize5::default(),
            index_asset: ZERO_ASSET,
            collateral_delta: 0,
            size_delta: 0,
            is_long: false,
            receiver: ZERO_ACCOUNT,
            acceptable_price: 0,
            min_out: 0,
            execution_fee: 0,
            block_height: 0,
            block_time: 0,
            withdraw_eth: false,
            callback_target: ZERO_CONTRACT
        }
    }
}

impl Hash for RequestKey {
    fn hash(self, ref mut state: Hasher) {
        self.account.hash(state);
        self.index.hash(state);
    }
}