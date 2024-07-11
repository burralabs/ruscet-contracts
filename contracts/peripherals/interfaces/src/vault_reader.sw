// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    asset::*,
};

abi VaultReader {
    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/
    */
    fn get_vault_asset_info_v3(
        vault: ContractId,
        position_manager_or_router: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256>;

    fn get_vault_asset_info_v4(
        vault: ContractId,
        position_manager_or_router: ContractId,
        rusd_amount: u256,
        assets: Vec<AssetId>
    ) -> Vec<u256>;
} 