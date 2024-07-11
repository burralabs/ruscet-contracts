// SPDX-License-Identifier: Apache-2.0
script;

use std::hash::*;
use std::bytes::*;
use std::bytes_conversions::{
    u64::*,
    b256::*,
    u256::*
};

fn main(data: Vec<Bytes>) -> (b256, u64) {
    let pricefeed_id = b256::from_le_bytes(data.get(0).unwrap());
    let new_price = u64::from_le_bytes(data.get(1).unwrap());

    (pricefeed_id, new_price)
}
