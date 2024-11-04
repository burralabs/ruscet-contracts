// SPDX-License-Identifier: Apache-2.0
library;

use pyth_interface::data_structures::price::PriceFeedId;
use std::bytes::Bytes;
use std::b512::B512;
use helpers::{
    context::*,
};

abi VaultPricefeed {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        price_signer: Address
    );

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
    fn set_price_signer(price_signer: Address);

    #[storage(read, write)]
    fn set_pyth_pricefeed(
        asset: AssetId,
        pricefeed_id: PriceFeedId,
        decimals: u32
    );

    #[storage(read, write)]
    fn set_pyth_price_configs(
        max_price_aheadness: u64,
        max_price_staleness: u64
    );

    #[storage(read, write)]
    fn set_asset_config(
        asset: AssetId,
        pyth_pricefeed: PriceFeedId,
        decimals: u32
    );

    /*
          ____ __     ___
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V /
      /_/_/       \_/  |_|\___| \_/\_/
    */
    #[storage(read)]
    fn get_price(
        asset: AssetId,
        maximize: bool
    ) -> u256;

    /*
          ____  ____        _     _ _
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn update_price(
        asset: AssetId,
        new_price: u64,
        signature: B512
    );
}