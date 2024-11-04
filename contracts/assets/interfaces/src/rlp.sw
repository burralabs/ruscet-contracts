// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    string::String,
};

use helpers::{
    context::Account,
};

abi RLP {
    #[storage(read, write)]
    fn initialize();

    /*
          ____     _       _           _
         / / /    / \   __| |_ __ ___ (_)_ __
        / / /    / _ \ / _` | '_ ` _ \| | '_ \
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|
    */
    #[storage(read, write)]
    fn set_gov(gov: Account);

    #[storage(read, write)]
    fn set_minter(minter: Account, is_active: bool);

    /*
          ____ __     ___
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V /
      /_/_/       \_/  |_|\___| \_/\_/
    */
    /// Returns the AssetId of the RLP token
    fn get_id() -> AssetId;

    /// Returns the total supply of the RLP asset
    #[storage(read)]
    fn total_rlp_supply() -> u64;
}
