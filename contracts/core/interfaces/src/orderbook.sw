// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    signed_64::*,
    utils::*,
    fixed_vec::FixedVecAssetIdSize5,
};

pub struct IncreaseOrder {
    pub account: Account,
    pub purchase_asset: AssetId,
    pub purchase_asset_amount: u256,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
    pub execution_fee: u64,
}

pub struct DecreaseOrder {
    pub account: Account,
    pub collateral_asset: AssetId,
    pub collateral_delta: u256,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
    pub execution_fee: u64,
}

pub struct SwapOrder {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub amount_in: u64,
    pub min_out: u64,
    pub trigger_ratio: u64,
    pub trigger_above_threshold: bool,
    pub should_unwrap: bool,
    pub execution_fee: u64,
}

abi Orderbook {
    #[storage(read, write)]
    fn initialize(
        router: ContractId,
        vault: ContractId,
        rusd: AssetId,
        min_execution_fee: u64,
        min_purchase_asset_amount_usd: u64
    );

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_min_execution_fee(min_execution_fee: u64);

    #[storage(read, write)]
    fn set_min_purchase_asset_amount_usd(min_purchase_asset_amount_usd: u64);

    #[storage(read, write)]
    fn set_gov(gov: Account);

    /*
          ____ __     ___  
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_swap_order(
        account: Account,
        order_index: u64
    ) -> (
        AssetId, AssetId, AssetId,
        u64, u64, u64,
        bool, bool, u64,
        SwapOrder
    );

    #[storage(read)]
    fn validate_position_order_price(
        trigger_above_threshold: bool,
        trigger_price: u256,
        index_asset: AssetId,
        maximize_price: bool,
        raise: bool 
    ) -> (u256, bool);

    #[storage(read)]
    fn get_increase_order(
        account: Account,
        order_index: u64
    ) -> (
        AssetId, u256, AssetId, AssetId,
        u256, bool, u256, bool, 
        u64, IncreaseOrder
    );

    #[storage(read)]
    fn get_decrease_order(
        account: Account,
        order_index: u64
    ) -> (
        AssetId, u256, AssetId,
        u256, bool, u256, bool, 
        u64, DecreaseOrder
    );

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[payable]
    #[storage(read, write)]
    fn create_increase_order(
        path: Vec<AssetId>,
        amount_in: u64,
        index_asset: AssetId,
        min_out: u64,
        size_delta: u256,
        collateral_asset: AssetId,
        is_long: bool,
        trigger_price: u256,
        trigger_above_threshold: bool,
        execution_fee: u64,
        should_wrap: bool
    );

    #[storage(read, write)]
    fn update_increase_order(
        order_index: u64,
        size_delta: u256,
        trigger_price: u256,
        trigger_above_threshold: bool
    );

    #[storage(read, write)]
    fn cancel_increase_order(order_index: u64);

    #[storage(read, write)]
    fn execute_increase_order(
        account: Account,
        order_index: u64,
        fee_receiver: Account
    );

    #[payable]
    #[storage(read, write)]
    fn create_decrease_order(
        index_asset: AssetId,
        size_delta: u256,
        collateral_asset: AssetId,
        collateral_delta: u256,
        is_long: bool,
        trigger_price: u256,
        trigger_above_threshold: bool,
    );

    #[storage(read, write)]
    fn execute_decrease_order(
        account: Account,
        order_index: u64,
        fee_receiver: Account
    );

    #[storage(read, write)]
    fn cancel_decrease_order(order_index: u64);

    #[storage(read, write)]
    fn update_decrease_order(
        order_index: u64,
        collateral_delta: u256,
        size_delta: u256,
        trigger_price: u256,
        trigger_above_threshold: bool
    );
}

impl IncreaseOrder {
    pub fn default() -> Self {
        Self {
            account: ZERO_ACCOUNT,
            purchase_asset: ZERO_ASSET,
            purchase_asset_amount: 0,
            collateral_asset: ZERO_ASSET,
            index_asset: ZERO_ASSET,
            size_delta: 0,
            is_long: false,
            trigger_price: 0,
            trigger_above_threshold: false,
            execution_fee: 0,
        }
    }
}

impl DecreaseOrder {
    pub fn default() -> Self {
        Self {
            account: ZERO_ACCOUNT,
            collateral_asset: ZERO_ASSET,
            collateral_delta: 0,
            index_asset: ZERO_ASSET,
            size_delta: 0,
            is_long: false,
            trigger_price: 0,
            trigger_above_threshold: false,
            execution_fee: 0,
        }
    }
}

impl SwapOrder {
    pub fn default() -> Self {
        Self {
            account: ZERO_ACCOUNT,
            path: FixedVecAssetIdSize5::default(),
            amount_in: 0,
            min_out: 0,
            trigger_ratio: 0,
            trigger_above_threshold: false,
            should_unwrap: false,
            execution_fee: 0,
        }
    }
}