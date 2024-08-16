// SPDX-License-Identifier: Apache-2.0
contract;

mod constants;
mod errors;
mod events;

/*
__     __          _ _     _   _ _   _ _     
\ \   / /_ _ _   _| | |_  | | | | |_(_) |___ 
 \ \ / / _` | | | | | __| | | | | __| | / __|
  \ V / (_| | |_| | | |_  | |_| | |_| | \__ \
   \_/ \__,_|\__,_|_|\__|  \___/ \__|_|_|___/
*/

use std::{
    block::{timestamp as tai64_timestamp},
    context::*,
    revert::require,
    storage::storage_vec::*,
    asset::*,
    math::*,
    hash::*
};
use helpers::{
    time::get_unix_timestamp,
    context::*, 
    utils::*,
    signed_256::Signed256,
};
use core_interfaces::{
    vault_utils::VaultUtils,
    vault_storage::{
        VaultStorage,
        Position,
        PositionKey,
    },
    vault_pricefeed::VaultPricefeed,
};
use asset_interfaces::rusd::RUSD;
use constants::*;
use errors::*;
use events::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,

    vault: ContractId = ZERO_CONTRACT,
    vault_storage: ContractId = ZERO_CONTRACT,

    is_initialized: bool = false,

    is_write_authorized: StorageMap<Account, bool> = StorageMap::<Account, bool> {},

    // tracks amount of RUSD debt for each supported asset
    rusd_amounts: StorageMap<AssetId, u256> = StorageMap::<AssetId, u256> {},

    // tracks the number of received tokens that can be used for leverage
    // tracked separately from asset_balances to exclude funds that are deposited 
    // as margin collateral
    pool_amounts: StorageMap<AssetId, u256> = StorageMap::<AssetId, u256> {},
    // tracks the amount of USD that is "guaranteed" by opened leverage positions
    // this value is used to calculate the redemption values for selling of RUSD
    // this is an estimated amount, it is possible for the actual guaranteed value to be lower
    // in the case of sudden price decreases, the guaranteed value should be corrected
    // after liquidations are carried out
    guaranteed_usd: StorageMap<AssetId, u256> = StorageMap::<AssetId, u256> {},
    // tracks the funding rates based on utilization
    cumulative_funding_rates: StorageMap<AssetId, u256> = StorageMap::<AssetId, u256> {},
    // tracks the number of tokens reserved for open leverage positions
    reserved_amounts: StorageMap<AssetId, u256> = StorageMap::<AssetId, u256> {},

    global_short_sizes: StorageMap<AssetId, u256> = StorageMap::<AssetId, u256> {},
}

impl VaultUtils for Contract {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault: ContractId,
        vault_storage: ContractId,
    ) {
        require(!storage.is_initialized.read(), Error::VaultUtilsAlreadyInitialized);
        storage.is_initialized.write(true);

        storage.gov.write(gov);
        storage.vault.write(vault);
        storage.vault_storage.write(vault_storage);
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_gov(new_gov: Account) {
        _only_gov();
        storage.gov.write(new_gov);
        log(SetGov { new_gov });
    }

    #[storage(read, write)]
    fn write_authorize(caller: Account, is_active: bool) {
        _only_gov();

        storage.is_write_authorized.insert(caller, is_active);
    }

    #[storage(read, write)]
    fn set_rusd_amount(asset: AssetId, amount: u256) {
        _only_gov();

        let rusd_amount = storage.rusd_amounts.get(asset).try_read().unwrap_or(0);
        if amount > rusd_amount {
            _increase_rusd_amount(asset, amount - rusd_amount);
        } else {
            _decrease_rusd_amount(asset, rusd_amount - amount);
        }
    }
    
    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_gov() -> Account {
        storage.gov.read()
    }

    #[storage(read)]
    fn is_authorized_caller(account: Account) -> bool {
        storage.is_write_authorized.get(account).try_read().unwrap_or(false)
    }

    #[storage(read)]
    fn get_vault_storage() -> ContractId {
        storage.vault_storage.read()
    }

    #[storage(read)]
    fn get_pool_amounts(asset: AssetId) -> u256 {
        _get_pool_amounts(asset)
    }

    #[storage(read)]
    fn get_rusd_amount(asset: AssetId) -> u256 {
        _get_rusd_amounts(asset)
    }

    #[storage(read)]
    fn get_reserved_amounts(asset: AssetId) -> u256 {
        _get_reserved_amounts(asset)
    }

    #[storage(read)]
    fn get_global_short_sizes(asset: AssetId) -> u256 {
        _get_global_short_sizes(asset)
    }

    #[storage(read)]
    fn get_guaranteed_usd(asset: AssetId) -> u256 {
        _get_guaranteed_usd(asset)
    }

    #[storage(read)]
    fn get_cumulative_funding_rates(asset: AssetId) -> u256 {
        _get_cumulative_funding_rates(asset)
    }

    #[storage(read)]
    fn get_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
    ) -> (
        u256, u256, u256,
        u256, u256, Signed256,
        bool, u64
    ) {
        let position_key = _get_position_key(
            account, 
            collateral_asset, 
            index_asset, 
            is_long
        );

        let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

        let position = vault_storage.get_position_by_key(position_key);
        (
            position.size, // 0
            position.collateral, // 1
            position.average_price, // 2
            position.entry_funding_rate, // 3
            position.reserve_amount, // 4
            position.realized_pnl, // 5
            // position.realized_pnl >= 0, // 6
            !position.realized_pnl.is_neg, // 6
            position.last_increased_time // 7
        )
    }

    #[storage(read)]
    fn get_position_delta(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
    ) -> (bool, u256) {
        _get_position_delta(
            account,
            collateral_asset,
            index_asset,
            is_long
        )
    }

    #[storage(read)]
    fn get_delta(
        index_asset: AssetId,
        size: u256,
        average_price: u256,
        is_long: bool,
        last_increased_time: u64,
    ) -> (bool, u256) {
        _get_delta(
            index_asset,
            size,
            average_price,
            is_long,
            last_increased_time
        )
    }

    #[storage(read)]
    fn get_entry_funding_rate(
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
    ) -> u256 {
        _get_entry_funding_rate(
            collateral_asset,
            index_asset,
            is_long
        )
    }

    #[storage(read)]
    fn get_next_funding_rate(asset: AssetId) -> u256 {
        _get_next_funding_rate(asset)
    }

    #[storage(read)]
    fn get_funding_fee(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        size: u256,
        entry_funding_rate: u256,
    ) -> u256 {
        _get_funding_fee(
            collateral_asset,
            size,
            entry_funding_rate
        )
    }

    #[storage(read)]
    fn get_position_fee(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        size_delta: u256,
    ) -> u256 {
        _get_position_fee(
            account,
            collateral_asset,
            index_asset,
            is_long,
            size_delta
        )
    }

    #[storage(read)]
    fn get_max_price(asset: AssetId) -> u256 {
        _get_max_price(asset)
    }

    #[storage(read)]
    fn get_min_price(asset: AssetId) -> u256 {
        _get_min_price(asset)
    }

    #[storage(read)]
    fn asset_to_usd_min(asset: AssetId, asset_amount: u256) -> u256 {
        _asset_to_usd_min(asset, asset_amount)
    }

    #[storage(read)]
    fn usd_to_asset_max(asset: AssetId, usd_amount: u256) -> u256 {
        _usd_to_asset_max(asset, usd_amount)
    }

    #[storage(read)]
    fn usd_to_asset_min(asset: AssetId, usd_amount: u256) -> u256 {
        _usd_to_asset_min(asset, usd_amount)
    }

    #[storage(read)]
    fn usd_to_asset(asset: AssetId, usd_amount: u256, price: u256) -> u256 {
        _usd_to_asset(asset, usd_amount, price)
    }

    #[storage(read)]
    fn get_redemption_amount(
        asset: AssetId, 
        rusd_amount: u256
    ) -> u256 {
        _get_redemption_amount(asset, rusd_amount)
    }

    #[storage(read)]
    fn get_redemption_collateral(asset: AssetId) -> u256 {
        _get_redemption_collateral(asset)
    }

    #[storage(read)]
    fn get_redemption_collateral_usd(asset: AssetId) -> u256 {
        let redemption_collateral = _get_redemption_collateral(asset);
        _asset_to_usd_min(
            asset,
            redemption_collateral
        )
    }

    #[storage(read)]
    fn get_fee_basis_points(
        asset: AssetId,
        rusd_delta: u256,
        fee_basis_points: u256,
        tax_basis_points: u256,
        increment: bool
    ) -> u256 {
        _get_fee_basis_points(
            asset,
            rusd_delta,
            fee_basis_points,
            tax_basis_points,
            increment,
        )
    }

    #[storage(read)]
    fn get_target_rusd_amount(asset: AssetId) -> u256 {
        _get_target_rusd_amount(asset)
    }

    #[storage(read)]
    fn get_utilization(asset: AssetId) -> u256 {
        let pool_amount = _get_pool_amounts(asset);
        if pool_amount == 0 {
            return 0;
        }

        let reserved_amount = _get_reserved_amounts(asset);
        
        reserved_amount * FUNDING_RATE_PRECISION / pool_amount
    }

    #[storage(read)]
    fn get_global_short_delta(asset: AssetId) -> (bool, u256) {
        _get_global_short_delta(asset)
    }

    #[storage(read)]
    fn adjust_for_decimals(
        amount: u256, 
        asset_div: AssetId, 
        asset_mul: AssetId
    ) -> u256 {
        _adjust_for_decimals(
            amount,
            asset_div,
            asset_mul
        )
    }

    #[storage(read)]
    fn validate_liquidation(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        should_raise: bool,
    ) -> (u256, u256) {
        _validate_liquidation(
            account,
            collateral_asset,
            index_asset,
            is_long,
            should_raise
        )
    }

    /*
          ____  ____        _     _ _ 
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn increase_pool_amount(asset: AssetId, amount: u256) {
        _only_authorized_caller();
        
        _increase_pool_amount(asset, amount);
    }

    #[storage(read, write)]
    fn decrease_pool_amount(asset: AssetId, amount: u256) {
        _only_authorized_caller();

        _decrease_pool_amount(asset, amount);
    }
    
    #[storage(read, write)]
    fn increase_rusd_amount(asset: AssetId, amount: u256) {
        _only_authorized_caller();

        _increase_rusd_amount(asset, amount);
    }

    #[storage(read, write)]
    fn decrease_rusd_amount(asset: AssetId, amount: u256) {
        _only_authorized_caller();

        _decrease_rusd_amount(asset, amount);
    }

    #[storage(read, write)]
    fn increase_guaranteed_usd(asset: AssetId, usd_amount: u256) {
        _only_authorized_caller();

        _increase_guaranteed_usd(asset, usd_amount);
    }

    #[storage(read, write)]
    fn decrease_guaranteed_usd(asset: AssetId, usd_amount: u256) {
        _only_authorized_caller();

        _decrease_guaranteed_usd(asset, usd_amount);
    }

    #[storage(read, write)]
    fn increase_reserved_amount(asset: AssetId, amount: u256) {
        _only_authorized_caller();

        _increase_reserved_amount(asset, amount);
    }

    #[storage(read, write)]
    fn decrease_reserved_amount(asset: AssetId, amount: u256) {
        _only_authorized_caller();

        _decrease_reserved_amount(asset, amount);
    }

    #[storage(read, write)]
    fn increase_global_short_size(asset: AssetId, amount: u256) {
        _only_authorized_caller();

        _increase_global_short_size(asset, amount);
    }

    #[storage(read, write)]
    fn decrease_global_short_size(asset: AssetId, amount: u256) {
        _only_authorized_caller();

        _decrease_global_short_size(asset, amount);
    }

    #[storage(read, write)]
    fn update_cumulative_funding_rate(
        collateral_asset: AssetId, 
        _index_asset: AssetId
    ) {
        _only_authorized_caller();

        _update_cumulative_funding_rate(
            collateral_asset,
            _index_asset
        );
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
    require(get_sender() == storage.gov.read(), Error::VaultForbiddenNotGov);
}

#[storage(read)]
fn _only_authorized_caller() {
    require(
        storage.is_write_authorized.get(get_sender()).try_read().unwrap_or(false),
        Error::VaultUtilsForbiddenNotAuthorizedCaller
    );
}

#[storage(read)]
fn _get_pool_amounts(asset: AssetId) -> u256 {
    storage.pool_amounts.get(asset).try_read().unwrap_or(0)
}

#[storage(read)]
fn _get_reserved_amounts(asset: AssetId) -> u256 {
    storage.reserved_amounts.get(asset).try_read().unwrap_or(0)
}

#[storage(read)]
fn _get_global_short_sizes(asset: AssetId) -> u256 {
    storage.global_short_sizes.get(asset).try_read().unwrap_or(0)
}

#[storage(read)]
fn _get_rusd_amounts(asset: AssetId) -> u256 {
    storage.rusd_amounts.get(asset).try_read().unwrap_or(0)
}

#[storage(read)]
fn _get_guaranteed_usd(asset: AssetId) -> u256 {
    storage.guaranteed_usd.get(asset).try_read().unwrap_or(0)
}

#[storage(read)]
fn _get_cumulative_funding_rates(asset: AssetId) -> u256 {
    storage.cumulative_funding_rates.get(asset).try_read().unwrap_or(0)
}

#[storage(read)]
fn _get_max_price(asset: AssetId) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let vault_pricefeed = abi(VaultPricefeed, vault_storage.get_pricefeed_provider().into());
    let include_amm_price = vault_storage.get_include_amm_price();
    let use_swap_pricing = vault_storage.get_use_swap_pricing();
    vault_pricefeed.get_price(
        asset, 
        true,
        include_amm_price,
        use_swap_pricing
    )
}

#[storage(read)]
fn _get_min_price(asset: AssetId) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let vault_pricefeed = abi(VaultPricefeed, vault_storage.get_pricefeed_provider().into());
    let include_amm_price = vault_storage.get_include_amm_price();
    let use_swap_pricing = vault_storage.get_use_swap_pricing();
    vault_pricefeed.get_price(
        asset, 
        false,
        include_amm_price,
        use_swap_pricing
    )
}

#[storage(read)]
fn _asset_to_usd_min(asset: AssetId, asset_amount: u256) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());
    
    if asset_amount == 0 {
        return 0;
    }

    let price = _get_min_price(asset);
    let decimals = vault_storage.get_asset_decimals(asset);

    (asset_amount * price) / 10.pow(decimals.as_u32()).as_u256()
}

#[storage(read)]
fn _usd_to_asset_max(asset: AssetId, usd_amount: u256) -> u256 {
    if usd_amount == 0 {
        return 0;
    }

    // @notice this is CORRECT (asset_max -> get_min_price)
    let price = _get_min_price(asset);

    _usd_to_asset(asset, usd_amount, price)
}

#[storage(read)]
fn _usd_to_asset_min(asset: AssetId, usd_amount: u256) -> u256 {
    if usd_amount == 0 {
        return 0;
    }

    // @notice this is CORRECT (asset_min -> get_max_price)
    let price = _get_max_price(asset);

    _usd_to_asset(asset, usd_amount, price)
}

#[storage(read)]
fn _usd_to_asset(asset: AssetId, usd_amount: u256, price: u256) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    require(price != 0, Error::VaultPriceQueriedIsZero);

    if usd_amount == 0 {
        return 0;
    }

    let decimals = vault_storage.get_asset_decimals(asset);

    (usd_amount * 10.pow(decimals.as_u32()).as_u256()) / price
}

#[storage(read)]
fn _adjust_for_decimals(
    amount: u256, 
    asset_div: AssetId, 
    asset_mul: AssetId
) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let rusd = vault_storage.get_rusd();
    let decimals_div = if asset_div == rusd {
        RUSD_DECIMALS
    } else {
        vault_storage.get_asset_decimals(asset_div)
    };

    let decimals_mul = if asset_mul == rusd {
        RUSD_DECIMALS
    } else {
        vault_storage.get_asset_decimals(asset_mul)
    };

    // this should fail if there's some weird stack overflow error
    require(
        decimals_div != 0 || decimals_mul != 0,
        Error::VaultDecimalsAreZero
    );

    amount * 10.pow(decimals_mul.as_u32()).as_u256() / 10.pow(decimals_div.as_u32()).as_u256()
}

fn _get_position_key(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    is_long: bool,
) -> b256 {
    keccak256(PositionKey {
        account,
        collateral_asset,
        index_asset,
        is_long,
    })
}

// note that if calling this function independently the cumulativeFundingRates 
// used in getFundingFee will not be the latest value
#[storage(read)]
fn _validate_liquidation(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    is_long: bool,
    should_raise: bool,
) -> (u256, u256) {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let position_key = _get_position_key(
        account, 
        collateral_asset, 
        index_asset, 
        is_long
    );

    let position = vault_storage.get_position_by_key(position_key);

    let (has_profit, delta) = _get_delta(
        index_asset,
        position.size,
        position.average_price,
        is_long,
        position.last_increased_time
    );

    let funding_fee = _get_funding_fee(
        collateral_asset,
        position.size,
        position.entry_funding_rate
    );
    let position_fee = _get_position_fee(
        account,
        collateral_asset,
        index_asset,
        is_long,
        position.size,
    );

    let margin_fees = funding_fee + position_fee;

    if !has_profit && position.collateral < delta {
        if should_raise {
            require(false, Error::VaultLossesExceedCollateral);
        }

        return (1, margin_fees);
    }

    let mut remaining_collateral = position.collateral;
    if !has_profit {
        remaining_collateral = position.collateral - delta;
    }

    if remaining_collateral < margin_fees {
        if should_raise {
            require(false, Error::VaultFeesExceedCollateral);
        }

        // cap the fees to the remainingCollateral
        return (1, remaining_collateral);
    }

    if remaining_collateral < margin_fees + vault_storage.get_liquidation_fee_usd() {
        if should_raise {
            require(false, Error::VaultLiquidationFeesExceedCollateral);
        }

        return (1, margin_fees);
    }

    let val1 = remaining_collateral * vault_storage.get_max_leverage().as_u256();
    let val2 = position.size * BASIS_POINTS_DIVISOR.as_u256();

    if val1 < val2 {
        if should_raise {
            require(false, Error::VaultMaxLeverageExceeded);
        }

        return (2, margin_fees);
    }

    return (0, margin_fees);
}

#[storage(read)]
fn _get_global_short_delta(asset: AssetId) -> (bool, u256) {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let size = _get_global_short_sizes(asset);
    if size == 0 {
        return (false, 0);
    }

    let next_price = _get_max_price(asset);
    let average_price = vault_storage.get_global_short_average_prices(asset);
    let has_profit = average_price > next_price;
    let price_delta = if has_profit {
        average_price - next_price
    } else {
        next_price - average_price
    };
    
    let delta = size * price_delta / average_price;
    (has_profit, delta)
}

#[storage(read)]
fn _get_target_rusd_amount(asset: AssetId) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let supply = abi(RUSD, vault_storage.get_rusd_contr().into()).total_supply();
    if supply == 0 {
        return 0;
    }

    let weight = vault_storage.get_asset_weight(asset);

    (weight * supply / vault_storage.get_total_asset_weights()).as_u256()
}

#[storage(read)]
fn _get_delta(
    index_asset: AssetId,
    size: u256,
    average_price: u256,
    is_long: bool,
    last_increased_time: u64
) -> (bool, u256) {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    require(average_price > 0, Error::VaultInvalidAveragePrice);

    let price = if is_long {
        _get_min_price(index_asset)
    } else {
        _get_max_price(index_asset)
    };

    let price_delta = if average_price > price {
        average_price - price
    } else {
        price - average_price
    };

    let mut delta = size * price_delta / average_price;

    let mut has_profit = false;
    if is_long {
        has_profit = price > average_price;
    } else {
        has_profit = average_price > price;
    }

    // if the minProfitTime has passed then there will be no min profit threshold
    // the min profit threshold helps to prevent front-running issues
    let min_bps = if get_unix_timestamp() > last_increased_time + vault_storage.get_min_profit_time() {
        0
    } else {
        vault_storage.get_min_profit_basis_points(index_asset)
    };

    if has_profit
        && (delta * BASIS_POINTS_DIVISOR.as_u256()) <= (size * min_bps.as_u256())
    {
        delta = 0;
    }

    (has_profit, delta)
}

#[storage(read)]
fn _get_redemption_amount(asset: AssetId, rusd_amount: u256) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let price = _get_max_price(asset);
    let redemption_amount = rusd_amount * PRICE_PRECISION / price;

    let rusd = vault_storage.get_rusd();
    _adjust_for_decimals(redemption_amount, rusd, asset)
}

#[storage(read)]
fn _get_redemption_collateral(asset: AssetId) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    if vault_storage.is_stable_asset(asset) {
        return _get_pool_amounts(asset);
    }

    let guaranteed_usd = _get_guaranteed_usd(asset);

    let collateral = _usd_to_asset_min(
        asset,
        guaranteed_usd
    );

    collateral + _get_pool_amounts(asset) - _get_reserved_amounts(asset)
}

#[storage(read)]
fn _get_position_fee(
    _account: Account,
    _collateral_asset: AssetId,
    _index_asset: AssetId,
    _is_long: bool,
    size_delta: u256,
) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    if size_delta == 0 {
        return 0;
    }

    let mut after_fee_usd = size_delta * (BASIS_POINTS_DIVISOR - vault_storage.get_margin_fee_basis_points()).as_u256();
    after_fee_usd = after_fee_usd / BASIS_POINTS_DIVISOR.as_u256();

    size_delta - after_fee_usd
}

#[storage(read)]
fn _get_entry_funding_rate(
    collateral_asset: AssetId,
    _index_asset: AssetId,
    _is_long: bool,
) -> u256 {
    _get_cumulative_funding_rates(collateral_asset)
}

#[storage(read)]
fn _get_next_funding_rate(asset: AssetId) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let last_funding_time = vault_storage.get_last_funding_times(asset);
    let funding_interval = vault_storage.get_funding_interval();

    if last_funding_time + funding_interval > get_unix_timestamp() {
        return 0;
    }

    let time_delta = get_unix_timestamp() - last_funding_time;

    let intervals =  time_delta / funding_interval;
    let pool_amount = _get_pool_amounts(asset);
    if pool_amount == 0 {
        return 0;
    }

    let funding_rate_factor = if vault_storage.is_stable_asset(asset) {
        vault_storage.get_stable_funding_rate_factor()
    } else {
        vault_storage.get_funding_rate_factor()
    };

    funding_rate_factor.as_u256() * _get_reserved_amounts(asset)
        * intervals.as_u256() / pool_amount
}

#[storage(read)]
fn _get_funding_fee(
    collateral_asset: AssetId,
    size: u256,
    entry_funding_rate: u256
) -> u256 {
    if size == 0 {
        return 0;
    }

    let mut funding_rate = _get_cumulative_funding_rates(collateral_asset);
    funding_rate = funding_rate - entry_funding_rate;
    if funding_rate == 0 {
        return 0;
    }

    size * funding_rate / FUNDING_RATE_PRECISION
}

#[storage(read)]
fn _get_position_delta(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    is_long: bool,
) -> (bool, u256) {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let position_key = _get_position_key(
        account, 
        collateral_asset, 
        index_asset, 
        is_long
    );

    let position = vault_storage.get_position_by_key(position_key);

    _get_delta(
        index_asset,
        position.size,
        position.average_price,
        is_long,
        position.last_increased_time
    )
}

// cases to consider
// 1. `initial_amount` is far from `target_amount`, action increases balance slightly => high rebate
// 2. `initial_amount` is far from `target_amount`, action increases balance largely => high rebate
// 3. `initial_amount` is close to `target_amount`, action increases balance slightly => low rebate
// 4. `initial_amount` is far from `target_amount`, action reduces balance slightly => high tax
// 5. `initial_amount` is far from `target_amount`, action reduces balance largely => high tax
// 6. `initial_amount` is close to `target_amount`, action reduces balance largely => low tax
// 7. `initial_amount` is above `target_amount`, nextAmount is below `target_amount` and vice versa
// 8. a large swap should have similar fees as the same trade split into multiple smaller swaps
#[storage(read)]
fn _get_fee_basis_points(
    asset: AssetId,
    rusd_delta: u256,
    fee_basis_points: u256,
    tax_basis_points: u256,
    should_increment: bool
) -> u256 {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    if !vault_storage.has_dynamic_fees() {
        return fee_basis_points;
    }

    let initial_amount = _get_rusd_amounts(asset);
    let mut next_amount = initial_amount + rusd_delta;
    if !should_increment {
        next_amount = if rusd_delta > initial_amount {
            0
        } else {
            initial_amount - rusd_delta
        };
    }

    let target_amount = _get_target_rusd_amount(asset);
    if target_amount == 0 {
        return fee_basis_points;
    }

    let initial_diff = if initial_amount > target_amount {
        initial_amount - target_amount
    } else {
        target_amount - initial_amount
    };

    let next_diff = if next_amount > target_amount {
        next_amount - target_amount
    } else {
        target_amount - next_amount
    };

    // action improves relative asset balance
    if next_diff < initial_diff {
        let rebate_bps = tax_basis_points * initial_diff / target_amount;
        return if rebate_bps > fee_basis_points {
            0
        } else {
            fee_basis_points - rebate_bps
        };
    }

    let mut avg_diff = (initial_diff + next_diff) / 2;
    if avg_diff > target_amount {
        avg_diff = target_amount;
    }

    let tax_bps = tax_basis_points * avg_diff / target_amount;
    
    fee_basis_points + tax_bps
}

#[storage(read, write)]
fn _increase_pool_amount(asset: AssetId, amount: u256) {
    let new_pool_amount = _get_pool_amounts(asset) + amount;
    storage.pool_amounts.insert(asset, new_pool_amount);
    log(WritePoolAmount { asset, pool_amount: new_pool_amount });

    let balance = balance_of(storage.vault.read(), asset);

    require(new_pool_amount <= balance.as_u256(), Error::VaultInvalidIncrease);

    log(IncreasePoolAmount { asset, amount });
}

#[storage(read, write)]
fn _decrease_pool_amount(asset: AssetId, amount: u256) {
    let pool_amount = _get_pool_amounts(asset);
    require(pool_amount >= amount, Error::VaultPoolAmountExceeded);

    let new_pool_amount = pool_amount - amount;
    storage.pool_amounts.insert(asset, new_pool_amount);
    log(WritePoolAmount { asset, pool_amount: new_pool_amount });

    require(
        _get_reserved_amounts(asset) <= new_pool_amount,
        Error::VaultReserveExceedsPool
    );

    log(DecreasePoolAmount { asset, amount });
}

#[storage(read, write)]
fn _increase_rusd_amount(asset: AssetId, amount: u256) {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let new_rusd_amount = _get_rusd_amounts(asset) + amount;
    storage.rusd_amounts.insert(asset, new_rusd_amount);
    log(WriteRusdAmount { asset, rusd_amount: new_rusd_amount });

    let max_rusd_amount = vault_storage.get_max_rusd_amount(asset);
    if max_rusd_amount != 0 {
        require(new_rusd_amount <= max_rusd_amount, Error::VaultMaxRusdExceeded);
    }
    log(IncreaseRusdAmount { asset, amount });
}

#[storage(read, write)]
fn _decrease_rusd_amount(asset: AssetId, amount: u256) {
    let value = _get_rusd_amounts(asset);
    // since RUSD can be minted using multiple assets
    // it is possible for the RUSD debt for a single asset to be less than zero
    // the RUSD debt is capped to zero for this case
    if value <= amount {
        storage.rusd_amounts.insert(asset, 0);
        log(WriteRusdAmount { asset, rusd_amount: 0 });
        log(DecreaseRusdAmount {
            asset,
            amount: value,
        });
    } else {
        let new_rusd_amount = value - amount;
        storage.rusd_amounts.insert(asset, new_rusd_amount);
        log(WriteRusdAmount { asset, rusd_amount: new_rusd_amount });
        log(DecreaseRusdAmount { asset, amount });
    }
}

#[storage(read, write)]
fn _increase_guaranteed_usd(asset: AssetId, usd_amount: u256) {
    let new_guaranteed_amount = _get_guaranteed_usd(asset) + usd_amount;
    storage.guaranteed_usd.insert(
        asset,
        new_guaranteed_amount
    );
    
    log(WriteGuaranteedAmount  { asset, guaranteed_amount: new_guaranteed_amount });
    log(IncreaseGuaranteedAmount {
        asset,
        amount: usd_amount,
    });
}

#[storage(read, write)]
fn _decrease_guaranteed_usd(asset: AssetId, usd_amount: u256) {
    let new_guaranteed_amount = _get_guaranteed_usd(asset) - usd_amount;
    storage.guaranteed_usd.insert(
        asset,
        new_guaranteed_amount
    );

    log(WriteGuaranteedAmount  { asset, guaranteed_amount: new_guaranteed_amount });
    log(DecreaseGuaranteedAmount {
        asset,
        amount: usd_amount,
    });
}

#[storage(read, write)]
fn _increase_reserved_amount(asset: AssetId, amount: u256) {
    let new_reserved_amount = _get_reserved_amounts(asset) + amount;
    storage.reserved_amounts.insert(
        asset,
        new_reserved_amount
    );
    log(WriteReservedAmount  { asset, reserved_amount: new_reserved_amount });

    require(
        _get_reserved_amounts(asset) <= _get_pool_amounts(asset),
        Error::VaultReserveExceedsPool
    );
    
    log(IncreaseReservedAmount { asset, amount });
}

#[storage(read, write)]
fn _decrease_reserved_amount(asset: AssetId, amount: u256) {
    if _get_reserved_amounts(asset) < amount {
        require(false, Error::VaultInsufficientReserve);
    }

    let new_reserved_amount = _get_reserved_amounts(asset) - amount;
    storage.reserved_amounts.insert(
        asset,
        new_reserved_amount
    );

    log(WriteReservedAmount  { asset, reserved_amount: new_reserved_amount });
    log(DecreaseReservedAmount { asset, amount });
}

#[storage(write)]
fn _update_global_short_size(asset: AssetId, global_short_size: u256) {
    storage.global_short_sizes.insert(
        asset,
        global_short_size
    );
    log(UpdateGlobalShortSize { asset, global_short_size }); 
}

#[storage(read, write)]
fn _increase_global_short_size(asset: AssetId, amount: u256) {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());
    
    _update_global_short_size(
        asset,
        _get_global_short_sizes(asset) + amount
    );

    let max_size = vault_storage.get_max_global_short_sizes(asset);
    if max_size != 0 {
        require(
            _get_global_short_sizes(asset) <= max_size,
            Error::VaultMaxShortsExceeded
        );
    }
}

#[storage(read, write)]
fn _decrease_global_short_size(asset: AssetId, amount: u256) {
    let global_short_size = _get_global_short_sizes(asset);

    if amount > global_short_size {
        _update_global_short_size(asset, 0);
        return;
    }

    _update_global_short_size(
        asset,
        global_short_size - amount
    );
}

#[storage(read, write)]
fn _update_cumulative_funding_rate(collateral_asset: AssetId, _index_asset: AssetId) {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let last_funding_time = vault_storage.get_last_funding_times(collateral_asset);
    let funding_interval = vault_storage.get_funding_interval();

    if last_funding_time == 0 {
        vault_storage.write_last_funding_time(
            collateral_asset, 
            get_unix_timestamp()
        );
        return;
    }

    if last_funding_time + funding_interval > get_unix_timestamp() {
        return;
    }

    let funding_rate = _get_next_funding_rate(collateral_asset);

    let new_cumulative_funding_rate = _get_cumulative_funding_rates(collateral_asset) + funding_rate;
    storage.cumulative_funding_rates.insert(
        collateral_asset, 
        new_cumulative_funding_rate
    );

    vault_storage.write_last_funding_time(collateral_asset, get_unix_timestamp());

    log(UpdateFundingRate {
        asset: collateral_asset,
        funding_rate: new_cumulative_funding_rate
    });
}