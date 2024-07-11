// SPDX-License-Identifier: Apache-2.0
library;

use std::hash::*;
use helpers::{
    context::*,
    signed_64::*,
    fixed_vec::FixedVecAssetIdSize5,
    utils::*
};

abi PositionRouter {
    #[storage(read, write)]
    fn initialize(
        base_position_manager: ContractId,
        vault: ContractId
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
    fn set_is_leverage_enabled(is_leverage_enabled: bool);

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

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn increase_position(
        path: Vec<AssetId>,
        index_asset: AssetId,
        amount_in: u64,
        min_out: u64,
        size_delta: u256,
        is_long: bool,
        acceptable_price: u256,
        referral_code: b256,
    ) -> bool;

    #[storage(read, write)]
    fn decrease_position(
        path: Vec<AssetId>,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account,
        acceptable_price: u256,
        min_out: u64,
    ) -> bool;
}
