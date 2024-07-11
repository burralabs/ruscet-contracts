// SPDX-License-Identifier: Apache-2.0
contract;

/*
__     __          _ _     ____       _           __               _ 
\ \   / /_ _ _   _| | |_  |  _ \ _ __(_) ___ ___ / _| ___  ___  __| |
 \ \ / / _` | | | | | __| | |_) | '__| |/ __/ _ \ |_ / _ \/ _ \/ _` |
  \ V / (_| | |_| | | |_  |  __/| |  | | (_|  __/  _|  __/  __/ (_| |
   \_/ \__,_|\__,_|_|\__| |_|   |_|  |_|\___\___|_|  \___|\___|\__,_|
*/

mod constants;
mod errors;

use std::{
    block::timestamp,
    math::*,
    context::*,
    revert::require,
    primitive_conversions::u64::*,
};
use std::bytes::Bytes;
use std::hash::*;
use helpers::{
    context::*, 
    zero::*, 
    utils::*,
    math::*,
};
use core_interfaces::vault_pricefeed::VaultPricefeed;
use interfaces::pricefeed::Pricefeed;
use pyth_interface::{
    data_structures::{
        price::*,
    },
    PythCore
};
use constants::*;
use errors::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,

    is_amm_enabled: bool = false,
    is_secondary_price_enabled: bool = false,
    use_v2_pricing: bool = false,
    favor_primary_price: bool = false,

    price_sample_space: u64 = 3,
    max_strict_price_deviation: u256 = 0,
    spread_threshold_basis_points: u64 = 30,

    secondary_pricefeed: ContractId = ZERO_CONTRACT,

    pyth_contract: ContractId = ZERO_CONTRACT,
    pyth_pricefeeds: StorageMap<AssetId, PriceFeedId> = StorageMap::<AssetId, PriceFeedId> {},
    valid_time_period: u64 = 3, // 3 tai64 ticks

    spread_basis_points: StorageMap<AssetId, u64> = StorageMap::<AssetId, u64> {},
    // Oracle can return prices for stablecoins
    // that differs from 1 USD by a larger percentage than stableSwapFeeBasisPoints
    // we use strictStableTokens to cap the price to 1 USD
    // this allows us to configure stablecoins like DAI as being a stableToken
    // while not being a strictStableToken
    strict_stable_assets: StorageMap<AssetId, bool> = StorageMap::<AssetId, bool> {},

    adjustment_basis_points: StorageMap<AssetId, u64> = StorageMap::<AssetId, u64> {},
    is_adjustment_additive: StorageMap<AssetId, bool> = StorageMap::<AssetId, bool> {},
    last_adjustment_timings: StorageMap<AssetId, u64> = StorageMap::<AssetId, u64> {},
}

impl VaultPricefeed for Contract {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        pyth_contract: ContractId
    ) {
        require(!storage.is_initialized.read(), Error::VaultPriceFeedAlreadyInitialized);
        storage.is_initialized.write(true);
        
        storage.gov.write(gov);
        storage.pyth_contract.write(pyth_contract);
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_valid_time_period(valid_time_period: u64) {
        _only_gov();
        storage.valid_time_period.write(valid_time_period);
    }

    #[storage(read, write)]
    fn set_adjustment(
        asset: AssetId,
        is_additive: bool,
        adjustment_bps: u64
    ) {
        _only_gov();
        require(
            adjustment_bps < MAX_ADJUSTMENT_BASIS_POINTS,
            Error::VaultPriceFeedInvalidAdjustmentBps
        );

        storage.is_adjustment_additive.insert(asset, is_additive);
        storage.adjustment_basis_points.insert(asset, adjustment_bps);
        storage.last_adjustment_timings.insert(asset, timestamp());
    }

    #[storage(read, write)]
    fn set_use_v2_pricing(use_v2_pricing: bool) {
        _only_gov();
        storage.use_v2_pricing.write(use_v2_pricing);
    }

    #[storage(read, write)]
    fn set_is_amm_enabled(is_enabled: bool) {
        _only_gov();
        storage.is_amm_enabled.write(is_enabled);
    }

    #[storage(read, write)]
    fn set_is_secondary_price_enabled(is_enabled: bool) {
        _only_gov();
        storage.is_secondary_price_enabled.write(is_enabled);
    }

    #[storage(read, write)]
    fn set_secondary_pricefeed(secondary_pricefeed: ContractId) {
        _only_gov();
        storage.secondary_pricefeed.write(secondary_pricefeed);
    }

    #[storage(read, write)]
    fn set_spread_basis_points(asset: AssetId, spread_basis_points: u64) {
        _only_gov();
        require(
            spread_basis_points <= MAX_SPREAD_BASIS_POINTS,
            Error::VaultPriceFeedInvalidSpreadBasisPoints
        );
        storage.spread_basis_points.insert(asset, spread_basis_points);
    }

    #[storage(read, write)]
    fn set_spread_threshold_basis_points(spread_threshold_basis_points: u64) {
        _only_gov();
        storage.spread_threshold_basis_points.write(spread_threshold_basis_points);
    }

    #[storage(read, write)]
    fn set_favor_primary_price(favor_primary_price: bool) {
        _only_gov();
        storage.favor_primary_price.write(favor_primary_price);
    }

    #[storage(read, write)]
    fn set_price_sample_space(price_sample_space: u64) {
        _only_gov();
        require(
            price_sample_space > 0,
            Error::VaultPriceFeedInvalidPriceSampleSpace
        );
        storage.price_sample_space.write(price_sample_space);
    }

    #[storage(read, write)]
    fn set_max_strict_price_deviation(max_strict_price_deviation: u256) {
        _only_gov();
        storage.max_strict_price_deviation.write(max_strict_price_deviation);
    }

    #[storage(read, write)]
    fn set_asset_config(
        asset: AssetId,
        pyth_pricefeed_id: PriceFeedId,
        is_strict_stable: bool
    ) {
        _only_gov();
        storage.pyth_pricefeeds.insert(asset, pyth_pricefeed_id);
        storage.strict_stable_assets.insert(asset, is_strict_stable);
    }
    
    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_valid_time_period() {
        storage.valid_time_period.read();
    }

    #[storage(read)]
    fn get_adjustment_basis_points(asset: AssetId) -> u64 {
        storage.adjustment_basis_points.get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn is_adjustment_additive(asset: AssetId) -> bool {
        storage.is_adjustment_additive.get(asset).try_read().unwrap_or(false)
    }

    #[storage(read)]
    fn get_price(
        asset: AssetId,
        maximize: bool,
        include_amm_price: bool,
        use_swap_pricing: bool
    ) -> u256 {
        let mut price = if storage.use_v2_pricing.read() {
            _get_price_v2(asset, maximize, include_amm_price)
        } else {
            _get_price_v1(asset, maximize, include_amm_price)
        };

        let adjustment_bps = storage.adjustment_basis_points.get(asset)
            .try_read().unwrap_or(0).as_u256();
        if adjustment_bps > 0 {
            let is_additive = storage.is_adjustment_additive.get(asset).try_read().unwrap_or(false);

            price = if is_additive {
                price * (BASIS_POINTS_DIVISOR + adjustment_bps) / BASIS_POINTS_DIVISOR
            } else {
                price * (BASIS_POINTS_DIVISOR - adjustment_bps) / BASIS_POINTS_DIVISOR
            };
        }

        price
    }

    #[storage(read)]
    fn get_price_v1(
        asset: AssetId,
        maximize: bool,
        include_amm_price: bool
    ) -> u256 {
        _get_price_v1(asset, maximize, include_amm_price)
    }

    #[storage(read)]
    fn get_price_v2(
        asset: AssetId,
        maximize: bool,
        include_amm_price: bool
    ) -> u256 {
        _get_price_v2(asset, maximize, include_amm_price)
    }

    #[storage(read)]
    fn get_primary_price(
        asset: AssetId,
        maximize: bool
    ) -> u256 {
        _get_primary_price(asset, maximize)
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    // this is purely a helper method for easier access within a script
    // not restricted, because literally anyone can call this
    // payable asset also not restricted because it's checked for within the Pyth contract
    #[payable]
    #[storage(read)]
    fn update_pyth_price(update_data: Vec<Bytes>) {
        let pyth = abi(PythCore, storage.pyth_contract.read().into());
        pyth.update_price_feeds{
            asset_id: AssetId::base().into(),
            coins: msg_amount()
        }(update_data);
    }
}

/*
    ____  ___       _                        _ 
   / / / |_ _|_ __ | |_ ___ _ __ _ __   __ _| |
  / / /   | || '_ \| __/ _ \ '__| '_ \ / _` | |
 / / /    | || | | | ||  __/ |  | | | | (_| | |
/_/_/    |___|_| |_|\__\___|_|  |_| |_|\__,_|_|
*/
#[storage(read)]
fn _only_gov() {
    require(get_sender() == storage.gov.read(), Error::VaultPriceFeedForbidden);
}

#[storage(read)]
fn _get_price_v1(
    asset: AssetId,
    maximize: bool,
    include_amm_price: bool
) -> u256 {
    let mut price = _get_primary_price(asset, maximize);

    if include_amm_price && storage.is_amm_enabled.read() {
        let amm_price = _get_amm_price(asset);

        if amm_price > 0 {
            if maximize && amm_price > price {
                price = amm_price;
            }

            if !maximize && amm_price < price {
                price = amm_price;
            }
        }
    }

    if storage.is_secondary_price_enabled.read() {
        price = _get_secondary_price(asset, price, maximize);
    }

    if storage.strict_stable_assets.get(asset).try_read().unwrap_or(false) {
        let delta = if price > ONE_USD {
            price - ONE_USD
        } else {
            ONE_USD - price
        };

        if delta <= storage.max_strict_price_deviation.read() {
            return ONE_USD;
        }

        // if _maximise and price is e.g. 1.02, return 1.02
        if maximize && price > ONE_USD {
            return price;
        }

        // if !_maximise and price is e.g. 0.98, return 0.98
        if !maximize && price < ONE_USD {
            return price;
        }

        return ONE_USD;
    }

    let spread_basis_points = storage.spread_basis_points.get(asset).try_read().unwrap_or(0).as_u256();

    if maximize {
        return price * (BASIS_POINTS_DIVISOR + spread_basis_points) / BASIS_POINTS_DIVISOR;
    }

    price * (BASIS_POINTS_DIVISOR - spread_basis_points) / BASIS_POINTS_DIVISOR
}

#[storage(read)]
fn _get_price_v2(
    asset: AssetId,
    maximize: bool,
    include_amm_price: bool
) -> u256 {
    let mut price = _get_primary_price(asset, maximize);

    if include_amm_price && storage.is_amm_enabled.read() {
        price = _get_amm_price_v2(asset, maximize, price);
    }

    if storage.is_secondary_price_enabled.read() {
        price = _get_secondary_price(asset, price, maximize);
    }

    if storage.strict_stable_assets.get(asset).try_read().unwrap_or(false) {
        let delta = if price > ONE_USD {
            price - ONE_USD
        } else {
            ONE_USD - price
        };

        if delta <= storage.max_strict_price_deviation.read() {
            return ONE_USD;
        }

        // if _maximise and price is e.g. 1.02, return 1.02
        if maximize && price > ONE_USD {
            return price;
        }

        // if !_maximise and price is e.g. 0.98, return 0.98
        if !maximize && price < ONE_USD {
            return price;
        }

        return ONE_USD;
    }

    let spread_basis_points = storage.spread_basis_points.get(asset)
        .try_read().unwrap_or(0).as_u256();

    if maximize {
        return price * (BASIS_POINTS_DIVISOR + spread_basis_points) / BASIS_POINTS_DIVISOR;
    }

    price * (BASIS_POINTS_DIVISOR - spread_basis_points) / BASIS_POINTS_DIVISOR
}

#[storage(read)]
fn _get_amm_price_v2(
    asset: AssetId,
    maximize: bool,
    primary_price: u256
) -> u256 {
    let amm_price = _get_amm_price(asset);
    if amm_price == 0 {
        return primary_price;
    }

    let diff = if amm_price > primary_price {
        amm_price - primary_price
    } else {
        primary_price - amm_price
    };

    if diff.mul(BASIS_POINTS_DIVISOR) < primary_price.mul(storage.spread_threshold_basis_points.read().as_u256()) {
        if storage.favor_primary_price.read() {
            return primary_price;
        }
        return amm_price;
    }

    if maximize && amm_price > primary_price {
        return amm_price;
    }

    if !maximize && amm_price < primary_price {
        return amm_price;
    }

    primary_price
}

// Note: Before calling this method, the Pyth pricefeed should be updated ideally via a script
#[storage(read)]
fn _get_primary_price(
    asset: AssetId,
    maximize: bool
) -> u256 {
    let pyth_pricefeed_id = storage.pyth_pricefeeds.get(asset).try_read().unwrap_or(ZERO);
    require(
        pyth_pricefeed_id != ZERO,
        Error::VaultPriceFeedInvalidPythPriceFeedId
    );

    let pyth = abi(PythCore, storage.pyth_contract.read().into());

    // reverts if price hasn't been updated within `valid_time_period`
    let pyth_price = pyth.price_no_older_than(
        storage.valid_time_period.read(),
        pyth_pricefeed_id
    );

    let price = pyth_price.price.as_u256();
    let expo: u32 = pyth_price.exponent;

    require(price > 0, Error::VaultPriceFeedCouldNotFetchPrice);

    price * PRICE_PRECISION / 10.pow(expo).as_u256()
}

#[storage(read)]
fn _get_secondary_price(
    asset: AssetId,
    reference_price: u256,
    maximize: bool 
) -> u256 {
    let secondary_pricefeed = storage.secondary_pricefeed.read();
    if secondary_pricefeed.non_zero() {
        return reference_price;
    }

    // @TODO: uncomment when secondary pricefeed is available
    // abi(SecondaryPricefeed).get_price(
    //     asset,
    //     reference_price,
    //     maximize
    // )
    0
}

fn _get_amm_price(asset: AssetId) -> u256 {
    0
}