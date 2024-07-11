// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{context::*};

pub struct Initialize {
    pub router: ContractId,
    pub vault: ContractId,
    pub rusd: AssetId,
    pub min_execution_fee: u64,
    pub min_purchase_asset_amount_usd: u64
}

pub struct UpdateMinExecutionFee {
    pub min_execution_fee: u64,
}

pub struct UpdateMinPurchaseAssetAmountUsd {
    pub min_purchase_asset_amount_usd: u64,
}

pub struct UpdateGov {
    pub gov: Account,
}

/*
 ___                                    
|_ _|_ __   ___ _ __ ___  __ _ ___  ___ 
 | || '_ \ / __| '__/ _ \/ _` / __|/ _ \
 | || | | | (__| | |  __/ (_| \__ \  __/
|___|_| |_|\___|_|  \___|\__,_|___/\___|
*/
pub struct CreateIncreaseOrder {
    pub account: Account,
    pub order_index: u64,
    pub purchase_asset: AssetId,
    pub purchase_asset_amount: u256,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
    pub execution_fee: u64,
}

pub struct CancelIncreaseOrder {
    pub account: Account,
    pub order_index: u64,
    pub purchase_asset: AssetId,
    pub purchase_asset_amount: u256,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
    pub execution_fee: u64,
}

pub struct ExecuteIncreaseOrder {
    pub account: Account,
    pub order_index: u64,
    pub purchase_asset: AssetId,
    pub purchase_asset_amount: u256,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
    pub execution_fee: u64,
    pub execution_price: u256,
}

pub struct UpdateIncreaseOrder {
    pub account: Account,
    pub order_index: u64,
    pub collateral_asset: AssetId,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
}

/*
 ____                                    
|  _ \  ___  ___ _ __ ___  __ _ ___  ___ 
| | | |/ _ \/ __| '__/ _ \/ _` / __|/ _ \
| |_| |  __/ (__| | |  __/ (_| \__ \  __/
|____/ \___|\___|_|  \___|\__,_|___/\___|
*/
pub struct CreateDecreaseOrder {
    pub account: Account,
    pub order_index: u64,
    pub collateral_asset: AssetId,
    pub collateral_delta: u256,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
    pub execution_fee: u64,
}

pub struct CancelDecreaseOrder {
    pub account: Account,
    pub order_index: u64,
    pub collateral_asset: AssetId,
    pub collateral_delta: u256,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
    pub execution_fee: u64,
}

pub struct ExecuteDecreaseOrder {
    pub account: Account,
    pub order_index: u64,
    pub collateral_asset: AssetId,
    pub collateral_delta: u256,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
    pub execution_fee: u64,
    pub execution_price: u256,
}

pub struct UpdateDecreaseOrder {
    pub account: Account,
    pub order_index: u64,
    pub collateral_asset: AssetId,
    pub collateral_delta: u256,
    pub index_asset: AssetId,
    pub size_delta: u256,
    pub is_long: bool,
    pub trigger_price: u256,
    pub trigger_above_threshold: bool,
}

/*
 ____                     
/ ___|_      ____ _ _ __  
\___ \ \ /\ / / _` | '_ \ 
 ___) \ V  V / (_| | |_) |
|____/ \_/\_/ \__,_| .__/ 
                   |_|
*/
pub struct CreateSwapOrder {
    pub account: Account,
    pub order_index: u64,
    pub path: Vec<AssetId>,
    pub amount_in: u64,
    pub min_out: u64,
    pub trigger_ratio: u64,
    pub trigger_above_threshold: bool,
    pub should_unwrap: bool,
    pub execution_fee: u64,
}

pub struct CancelSwapOrder {
    pub account: Account,
    pub order_index: u64,
    pub path: Vec<AssetId>,
    pub amount_in: u64,
    pub min_out: u64,
    pub trigger_ratio: u64,
    pub trigger_above_threshold: bool,
    pub should_unwrap: bool,
    pub execution_fee: u64,
}

pub struct UpdateSwapOrder {
    pub account: Account,
    pub order_index: u64,
    pub path: Vec<AssetId>,
    pub amount_in: u64,
    pub min_out: u64,
    pub trigger_ratio: u64,
    pub trigger_above_threshold: bool,
    pub should_unwrap: bool,
    pub execution_fee: u64,
}

pub struct ExecuteSwapOrder {
    pub account: Account,
    pub order_index: u64,
    pub path: Vec<AssetId>,
    pub amount_in: u64,
    pub min_out: u64,
    pub amount_out: u64,
    pub trigger_ratio: u64,
    pub trigger_above_threshold: bool,
    pub should_unwrap: bool,
    pub execution_fee: u64,
}