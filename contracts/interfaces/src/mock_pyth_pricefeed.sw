// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    storage::storage_string::*,
    bytes::*,
    string::String
};
use helpers::{
    context::Account,
};

pub struct Price {
    pub confidence: u64,
    pub price: u64,
    pub exponent: u32,
    // The TAI64 timestamp describing when the price was published
    pub publish_time: u64,
}

abi MockPythPricefeed {
    #[storage(read, write)]
    fn initialize(gov: Account);
    
    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_pricefeed_config(
        pricefeed_id: b256,
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
    fn price(pricefeed_id: b256) -> Price;

    #[storage(read)]
    fn price_no_older_than(time_period: u64, pricefeed_id: b256) -> Price;

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    // anyone can call this (this is only a MockPythPricefeed, after all)
    #[storage(read, write)]
    fn update_price_feed(update_data: Vec<Bytes>);
}

impl Price {
    pub fn new() -> Self {
        Self {
            confidence: 0,
            exponent: 0,
            price: 0,
            publish_time: 0,
        }
    }

    pub fn from(
        confidence: u64,
        exponent: u32,
        price: u64,
        publish_time: u64,
    ) -> Self {
        Self {
            confidence,
            exponent,
            price,
            publish_time,
        }
    }
}