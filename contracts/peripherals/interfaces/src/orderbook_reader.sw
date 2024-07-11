// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    asset::*,
};

abi OrderbookReader {
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
    );

    fn get_decrease_orders(
        orderbook_: ContractId,
        account: Address,
        indices: Vec<u64>
    ) -> (
        Vec<u256>, 
        Vec<AssetId>
    );

    fn get_swap_orders(
        orderbook_: ContractId,
        account: Address,
        indices: Vec<u64>
    ) -> (
        Vec<u256>, 
        Vec<AssetId>
    );
} 