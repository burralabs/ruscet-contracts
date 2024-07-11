// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    fixed_vec::FixedVecAssetIdSize5
};
    

/*
 ___                                    
|_ _|_ __   ___ _ __ ___  __ _ ___  ___ 
 | || '_ \ / __| '__/ _ \/ _` / __|/ _ \
 | || | | | (__| | |  __/ (_| \__ \  __/
|___|_| |_|\___|_|  \___|\__,_|___/\___|
*/
pub struct CreateIncreasePosition {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub amount_in: u64,
    pub min_out: u64,
    pub size_delta: u256,
    pub is_long: bool,
    pub acceptable_price: u256,
    pub execution_fee: u64,
    pub index: u64,
    pub queue_index: u64,
    pub block_height: u32,
    pub block_time: u64,
}

pub struct ExecuteIncreasePosition {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub amount_in: u64,
    pub min_out: u64,
    pub size_delta: u256,
    pub is_long: bool,
    pub acceptable_price: u256,
    pub execution_fee: u64,
    pub block_gap: u32,
    pub time_gap: u64
}

pub struct CancelIncreasePosition {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub amount_in: u64,
    pub min_out: u64,
    pub size_delta: u256,
    pub is_long: bool,
    pub acceptable_price: u256,
    pub execution_fee: u64,
    pub block_gap: u32,
    pub time_gap: u64
}

/*
 ____                                    
|  _ \  ___  ___ _ __ ___  __ _ ___  ___ 
| | | |/ _ \/ __| '__/ _ \/ _` / __|/ _ \
| |_| |  __/ (__| | |  __/ (_| \__ \  __/
|____/ \___|\___|_|  \___|\__,_|___/\___|
*/

pub struct CreateDecreasePosition {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub collateral_delta: u256,
    pub size_delta: u256,
    pub is_long: bool,
    pub receiver: Account,
    pub acceptable_price: u256,
    pub min_out: u64,
    pub execution_fee: u64,
    pub index: u64,
    pub queue_index: u64,
    pub block_height: u32,
    pub block_time: u64
}

pub struct ExecuteDecreasePosition {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub collateral_delta: u256,
    pub size_delta: u256,
    pub is_long: bool,
    pub receiver: Account,
    pub acceptable_price: u256,
    pub min_out: u64,
    pub execution_fee: u64,
    pub block_gap: u32,
    pub time_gap: u64
}

pub struct CancelDecreasePosition {
    pub account: Account,
    pub path: FixedVecAssetIdSize5,
    pub index_asset: AssetId,
    pub collateral_delta: u256,
    pub size_delta: u256,
    pub is_long: bool,
    pub receiver: Account,
    pub acceptable_price: u256,
    pub min_out: u64,
    pub execution_fee: u64,
    pub block_gap: u32,
    pub time_gap: u64
}

/*
 __  __ _          
|  \/  (_)___  ___ 
| |\/| | / __|/ __|
| |  | | \__ \ (__ 
|_|  |_|_|___/\___|
*/
pub struct SetPositionKeeper {
    pub account: Account,
    pub is_active: bool
}

pub struct SetMinExecutionFee {
    pub min_execution_fee: u64
}

pub struct SetIsLeverageEnabled {
    pub is_leverage_enabled: bool
}

pub struct SetDelayValues {
    pub min_block_delay_keeper: u32,
    pub min_time_delay_public: u64,
    pub max_time_delay: u64 
}

pub struct SetRequestKeysStartValues {
    pub increase_position_request_keys_start: u64,
    pub decrease_position_request_keys_start: u64
}

pub struct SetCallbackGasLimit {
    pub callback_gas_limit: u64
}

pub struct SetCustomCallbackGasLimit {
    pub callback_target: ContractId,
    pub callback_gas_limit: u64
}

pub struct Callback {
    pub callback_target: ContractId,
    pub success: bool,
    pub callback_gas_limit: u64
}