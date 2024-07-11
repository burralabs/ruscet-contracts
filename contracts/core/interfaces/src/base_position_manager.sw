// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    signed_64::*,
};

abi BasePositionManager {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault: ContractId,
        router: ContractId,
        shorts_tracker: ContractId,
        referral_storage: ContractId,
        deposit_fee: u64
    );

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
    fn register_child(child: ContractId);
    
    #[storage(read, write)]
    fn set_deposit_fee(deposit_fee: u64);

    #[storage(read, write)]
    fn set_increase_position_buffer_bps(
        increase_position_buffer_bps: u64
    );

    #[storage(read, write)]
    fn set_referral_storage(referral_storage: ContractId);

    #[storage(read, write)]
    fn set_max_global_sizes(
        assets: Vec<AssetId>,
        long_sizes: Vec<u256>,
        short_sizes: Vec<u256>
    );

    #[storage(read, write)]
    fn withdraw_fees(
        asset: AssetId,
        receiver: Account 
    );

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_referral_storage() -> ContractId;

    #[storage(read)]
    fn get_max_global_long_sizes(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_max_global_short_sizes(asset: AssetId) -> u256;

    #[storage(read)]
    fn get_fee_reserves(asset: AssetId) -> u64;

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[payable]
    #[storage(read, write)]
    fn collect_fees(
        account: Account,
        path: Vec<AssetId>,
        amount_in: u64,
        index_asset: AssetId,
        is_long: bool,
        size_delta: u256 
    ) -> u64;

    #[payable]
    #[storage(read)]
    fn increase_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        size_delta: u256,
        is_long: bool,
        price: u256 
    );

    #[payable]
    #[storage(read)]
    fn decrease_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account,
        price: u256 
    ) -> u256;

    #[payable]
    #[storage(read)]
    fn swap(
        path: Vec<AssetId>,
        min_out: u64,
        receiver: Account
    ) -> u64;
} 