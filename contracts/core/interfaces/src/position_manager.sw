// SPDX-License-Identifier: Apache-2.0
library;

use std::hash::*;
use helpers::{
    context::*,
    signed_64::*,
    utils::*
};

abi PositionManager {
    #[storage(read, write)]
    fn initialize(
        base_position_manager: ContractId,
        vault: ContractId,
        router: ContractId,
    );

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_order_keeper(order_keeper: Address, is_active: bool);

    #[storage(read, write)]
    fn set_liquidator(liquidator: Address, is_active: bool);

    #[storage(read, write)]
    fn set_partner(partner: Address, is_active: bool);

    #[storage(read, write)]
    fn set_in_legacy_mode(in_legacy_mode: bool);

    #[storage(read, write)]
    fn set_should_validator_increase_order(
        should_validator_increase_order: bool
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

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[payable]
    #[storage(read)]
    fn increase_position(
        path: Vec<AssetId>,
        index_asset: AssetId,
        amount_in_: u64,
        min_out: u64,
        size_delta: u256,
        is_long: bool,
        price: u256
    );
}
