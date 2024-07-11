// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____           _ _   _               ____             _              ____                _           
|  _ \ ___  ___(_) |_(_) ___  _ __   |  _ \ ___  _   _| |_ ___ _ __  |  _ \ ___  __ _  __| | ___ _ __ 
| |_) / _ \/ __| | __| |/ _ \| '_ \  | |_) / _ \| | | | __/ _ \ '__| | |_) / _ \/ _` |/ _` |/ _ \ '__|
|  __/ (_) \__ \ | |_| | (_) | | | | |  _ < (_) | |_| | ||  __/ |    |  _ <  __/ (_| | (_| |  __/ |   
|_|   \___/|___/_|\__|_|\___/|_| |_| |_| \_\___/ \__,_|\__\___|_|    |_| \_\___|\__,_|\__,_|\___|_|
*/

use std::{
    block::timestamp,
    context::*,
    revert::require,
};
use std::hash::*;
use peripheral_interfaces::position_router_reader::PositionRouterReader;
use core_interfaces::{
    position_router::PositionRouter,
};
use interfaces::wrapped_asset::{
    WrappedAsset as WrappedAssetABI
};
use helpers::{
    context::*, 
    utils::*
};

impl PositionRouterReader for Contract {
    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/
    */
    fn get_transfer_asset_of_increase_position_requests(
        position_router_: ContractId,
        end_index_: u64
    ) -> (
        Vec<u64>, 
        Vec<AssetId>
    ) {
        let position_router = abi(PositionRouter, position_router_.into());
        let mut end_index = end_index_;

        // increasePositionRequestKeysStart,
        // increasePositionRequestKeys.length,
        // decreasePositionRequestKeysStart,
        // decreasePositionRequestKeys.length
        let (mut index, len, _, _) = position_router.get_request_queue_lengths();

        if end_index > len {
            end_index = len;
        }

        let mut request_indices: Vec<u64> = Vec::new(); // length: end_index - index
        let mut transfer_assets: Vec<AssetId> = Vec::new(); // length: end_index - index

        while index < end_index {
            let key = position_router.get_increase_position_request_keys(index);
            let path = position_router.get_increase_position_request_path(key);

            if path.len() > 0 {
                transfer_assets.push(path.get(0).unwrap());
            } else {
                // some dummy value
                transfer_assets.push(AssetId::from(0x6969420000000000000000000000000000000000000000000000000000000000));
            }

            request_indices.push(index);

            index += 1;
        }

        (request_indices, transfer_assets)
    }
}