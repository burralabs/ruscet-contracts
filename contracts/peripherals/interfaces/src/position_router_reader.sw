// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    asset::*,
};

abi PositionRouterReader {
    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/
    */
    fn get_transfer_asset_of_increase_position_requests(
        position_router_: ContractId,
        end_index: u64
    ) -> (
        Vec<u64>, 
        Vec<AssetId>
    );
} 