// SPDX-License-Identifier: Apache-2.0
contract;

/*
  ___          _           _                 _      ____                _           
 / _ \ _ __ __| | ___ _ __| |__   ___   ___ | | __ |  _ \ ___  __ _  __| | ___ _ __ 
| | | | '__/ _` |/ _ \ '__| '_ \ / _ \ / _ \| |/ / | |_) / _ \/ _` |/ _` |/ _ \ '__|
| |_| | | | (_| |  __/ |  | |_) | (_) | (_) |   <  |  _ <  __/ (_| | (_| |  __/ |   
 \___/|_|  \__,_|\___|_|  |_.__/ \___/ \___/|_|\_\ |_| \_\___|\__,_|\__,_|\___|_|   
*/

use std::{
    block::timestamp,
    context::*,
    revert::require,
};
use std::hash::*;
use peripheral_interfaces::orderbook_reader::OrderbookReader;
use core_interfaces::{
    orderbook::{
        Orderbook,
        IncreaseOrder,
        DecreaseOrder,
        SwapOrder
    }
};
use interfaces::wrapped_asset::{
    WrappedAsset as WrappedAssetABI
};
use helpers::{
    context::*, 
    utils::*,
    transfer::*,
    asset::*
};

impl OrderbookReader for Contract {
    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/
    */
    fn get_increase_orders(
        orderbook_: ContractId,
        account: Address,
        indices: Vec<u64>
    ) -> (
        Vec<u256>, 
        Vec<AssetId>
    ) {
        let mut i = 0;
        let mut _uint_len = 5;
        let mut _addr_len = 3;

        let mut uint_props: Vec<u256> = Vec::new(); // length: vars.uint_len * indices.len
        let mut address_props: Vec<AssetId> = Vec::new(); // length: vars.address_len * indices.len

        let orderbook = abi(Orderbook, orderbook_.into());

        while i < indices.len() {
            let index = indices.get(i).unwrap();

            let (
                purchase_asset,
                purchase_asset_amount,
                collateral_asset,
                index_asset,
                size_delta,
                is_long,
                trigger_price,
                trigger_above_threshold,
                _, // execution_fee
                _
            ) = orderbook.get_increase_order(account, index);

            uint_props.push(purchase_asset_amount);
            uint_props.push(size_delta);
            uint_props.push(if is_long { 1 } else { 0 });
            uint_props.push(trigger_price);
            uint_props.push(if trigger_above_threshold { 1 } else { 0 });

            address_props.push(purchase_asset);
            address_props.push(collateral_asset);
            address_props.push(index_asset);

            i += 1;
        }
        
        (uint_props, address_props)
    }

    fn get_decrease_orders(
        orderbook_: ContractId,
        account: Address,
        indices: Vec<u64>
    ) -> (
        Vec<u256>, 
        Vec<AssetId>
    ) {
        let mut i = 0;
        let mut _uint_len = 5;
        let mut _addr_len = 3;

        let mut uint_props: Vec<u256> = Vec::new(); // length: vars.uint_len * indices.len
        let mut address_props: Vec<AssetId> = Vec::new(); // length: vars.address_len * indices.len

        let orderbook = abi(Orderbook, orderbook_.into());

        while i < indices.len() {
            let index = indices.get(i).unwrap();

            let (
                collateral_asset,
                collateral_delta,
                index_asset,
                size_delta,
                is_long,
                trigger_price,
                trigger_above_threshold,
                _, // execution_fee
                _
            ) = orderbook.get_decrease_order(account, index);

            uint_props.push(collateral_delta);
            uint_props.push(size_delta);
            uint_props.push(if is_long { 1 } else { 0 });
            uint_props.push(trigger_price);
            uint_props.push(if trigger_above_threshold { 1 } else { 0 });

            address_props.push(collateral_asset);
            address_props.push(index_asset);

            i += 1;
        }
        
        (uint_props, address_props)
    }

    fn get_swap_orders(
        orderbook_: ContractId,
        account: Address,
        indices: Vec<u64>
    ) -> (
        Vec<u256>, 
        Vec<AssetId>
    ) {
        let mut i = 0;
        let mut _uint_len = 5;
        let mut _addr_len = 3;

        let mut uint_props: Vec<u256> = Vec::new(); // length: vars.uint_len * indices.len
        let mut asset_props: Vec<AssetId> = Vec::new(); // length: vars.address_len * indices.len

        let orderbook = abi(Orderbook, orderbook_.into());

        while i < indices.len() {
            let index = indices.get(i).unwrap();

            let (
                path_0,
                path_1,
                path_2,
                amount_in,
                min_out,
                trigger_ratio,
                trigger_above_threshold,
                should_unwrap,
                _, // execution_fee
                _
            ) = orderbook.get_swap_order(account, index);

            uint_props.push(amount_in.as_u256());
            uint_props.push(min_out.as_u256());
            uint_props.push(trigger_ratio.as_u256());
            uint_props.push(if trigger_above_threshold { 1 } else { 0 });
            uint_props.push(if should_unwrap { 1 } else { 0 });

            asset_props.push(path_0);
            asset_props.push(path_1);
            asset_props.push(path_2);

            i += 1;
        }
        
        (uint_props, asset_props)
    }
}