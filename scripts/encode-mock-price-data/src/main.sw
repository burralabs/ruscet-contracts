// SPDX-License-Identifier: Apache-2.0
script;

use std::hash::*;
use std::bytes::*;
use std::bytes_conversions::{
    u64::*,
    b256::*,
    u256::*
};

fn main(
    pricefeed_id: b256,
    new_price: u64,
) -> Vec<Bytes> {
    let mut vec: Vec<Bytes> = Vec::new();

    vec.push(pricefeed_id.to_le_bytes());
    vec.push(new_price.to_le_bytes());

    vec
}