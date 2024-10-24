// SPDX-License-Identifier: Apache-2.0
contract;

mod constants;
mod events;
mod errors;

/*
__     __          _ _     ____  _                             
\ \   / /_ _ _   _| | |_  / ___|| |_ ___  _ __ __ _  __ _  ___ 
 \ \ / / _` | | | | | __| \___ \| __/ _ \| '__/ _` |/ _` |/ _ \
  \ V / (_| | |_| | | |_   ___) | || (_) | | | (_| | (_| |  __/
   \_/ \__,_|\__,_|_|\__| |____/ \__\___/|_|  \__,_|\__, |\___|
                                                    |___/
*/

use std::{
    context::*,
    revert::require,
    storage::storage_vec::*,
    math::*,
    primitive_conversions::{
        u8::*,
        u64::*,
    }
};
use std::hash::*;
use helpers::{
    context::*, 
    utils::*,
    signed_256::*,
    zero::*
};
use core_interfaces::{
    vault_storage::{
        VaultStorage,
        Position,
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
    is_initialized: bool = false,

    has_dynamic_fees: bool = false,
    min_profit_time: u64 = 0,

    /// only `Account`s that are write-authorized into VaultRouter storage
    is_write_authorized: StorageMap<Account, bool> = StorageMap {},

    /// ---------------------  Fees  ---------------------
    /// charged when liquidating a position
    /// denominated in USD
    liquidation_fee_usd: u256 = DEFAULT_LIQUIDATION_FEE_USD,
    /// general tax applied to all assets to generate protocol revenue
    tax_basis_points: u64 = 50, // 0.5%
    /// reduced tax for stable assets
    stable_tax_basis_points: u64 = 20, // 0.2%
    /// charged when minting/burning RLP/RUSD assets
    /// helps maintain the stability of the RLP pool and discourage rapid entering and exiting.
    mint_burn_fee_basis_points: u64 = 30, // 0.3%
    /// charged when swapping b/w different assets within the protocol
    swap_fee_basis_points: u64 = 30, // 0.3%
    /// reduced swap fee for stable assets
    stable_swap_fee_basis_points: u64 = 4, // 0.04%
    /// applied to size of leveraged positions
    margin_fee_basis_points: u64 = 10, // 0.1%

    // Externals
    router: ContractId = ZERO_CONTRACT,
    // this is the RUSD contract
    rusd_contr: ContractId = ZERO_CONTRACT,
    // this is the RUSD native asset (AssetId::new(rusd_contr, ZERO))
    rusd: AssetId = ZERO_ASSET,
    pricefeed_provider: ContractId = ZERO_CONTRACT,

    // Funding
    total_asset_weights: u64 = 0,

    // Misc
    approved_routers: StorageMap<Account, StorageMap<Account, bool>> = StorageMap {},
    is_liquidator: StorageMap<Account, bool> = StorageMap {},

    whitelisted_asset_count: u64 = 0,
    all_whitelisted_assets: StorageVec<AssetId> = StorageVec {},

    whitelisted_assets: StorageMap<AssetId, bool> = StorageMap {},
    asset_decimals: StorageMap<AssetId, u8> = StorageMap {},
    min_profit_basis_points: StorageMap<AssetId, u64> = StorageMap {},
    stable_assets: StorageMap<AssetId, bool> = StorageMap {},
    shortable_assets: StorageMap<AssetId, bool> = StorageMap {},

    // allows customisation of index composition
    asset_weights: StorageMap<AssetId, u64> = StorageMap {},
    // allows setting a max amount of RUSD debt for an asset
    max_rusd_amounts: StorageMap<AssetId, u256> = StorageMap {},

    // allows specification of an amount to exclude from swaps
    // can be used to ensure a certain amount of liquidity is available for leverage positions
    buffer_amounts: StorageMap<AssetId, u256> = StorageMap {},
    // tracks the last time funding was updated for a token
    last_funding_times: StorageMap<AssetId, u64> = StorageMap {},
    // tracks all open Positions
    positions: StorageMap<b256, Position> = StorageMap {},
    // tracks amount of fees per asset
    fee_reserves: StorageMap<AssetId, u256> = StorageMap {},
    /// tracks average entry price for all short positions of each Asset
    /// value is weighted average at which all short positions for that asset were opened.
    global_short_average_prices: StorageMap<AssetId, u256> = StorageMap {},
    /// defines maximum allowed size for the total short positions for an Asset
    /// risk management feature that prevents the protocol from having too much exposure to 
    /// short positions for any single asset.
    max_global_short_sizes: StorageMap<AssetId, u256> = StorageMap {},
}

impl VaultStorage for Contract {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        rusd_contr: ContractId,
        rusd: AssetId,
        pricefeed_provider: ContractId,
    ) {
        _initialize(gov, rusd_contr, rusd, pricefeed_provider);
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(write)]
    fn set_gov(gov: Account) {
        _only_gov();
        storage.gov.write(gov);
        log(SetGov { gov });
    }

    #[storage(write)]
    fn write_authorize(account: Account, is_authorized: bool) {
        _only_gov();
        storage.is_write_authorized.insert(account, is_authorized);
        log(WriteAuthorize { account, is_authorized });
    }

    #[storage(write)]
    fn set_liquidator(liquidator: Account, is_active: bool) {
        _only_gov();
        storage.is_liquidator.insert(liquidator, is_active);
        log(SetLiquidator { liquidator, is_active });
    }

    #[storage(write)]
    fn set_buffer_amount(asset: AssetId, buffer_amount: u256) {
        _only_gov();
        storage.buffer_amounts.insert(asset, buffer_amount);
        log(SetBufferAmount { asset, buffer_amount });
    }

    #[storage(write)]
    fn set_max_rusd_amount(asset: AssetId, max_rusd_amount: u256) {
        _only_gov();
        storage.max_rusd_amounts.insert(asset, max_rusd_amount);
        log(SetMaxRusdAmount { asset, max_rusd_amount });
    }

    #[storage(write)]
    fn set_pricefeed(pricefeed: ContractId) {
        _only_gov();
        storage.pricefeed_provider.write(pricefeed);
        log(SetPricefeedProvider { pricefeed });
    }

    #[storage(write)]
    fn set_router(router: ContractId) {
        _only_gov();
        storage.router.write(router);
        log(SetRouter { router });
    }

    #[storage(read, write)]
    fn set_fees(
        tax_basis_points: u64,
        stable_tax_basis_points: u64,
        mint_burn_fee_basis_points: u64,
        swap_fee_basis_points: u64,
        stable_swap_fee_basis_points: u64,
        margin_fee_basis_points: u64,
        liquidation_fee_usd: u256,
        min_profit_time: u64,
        has_dynamic_fees: bool,
    ) {
        _only_gov();

        require(
            tax_basis_points <= MAX_FEE_BASIS_POINTS &&
            stable_tax_basis_points <= MAX_FEE_BASIS_POINTS &&
            mint_burn_fee_basis_points <= MAX_FEE_BASIS_POINTS &&
            swap_fee_basis_points <= MAX_FEE_BASIS_POINTS &&
            stable_swap_fee_basis_points <= MAX_FEE_BASIS_POINTS &&
            margin_fee_basis_points <= MAX_FEE_BASIS_POINTS,
            Error::VaultStorageInvalidFeeBasisPoints
        );
        // require(liquidation_fee_usd <= MAX_LIQUIDATION_FEE_USD, Error::VaultStorageInvalidLiquidationFeeUsd);

        storage.tax_basis_points.write(tax_basis_points);
        storage.stable_tax_basis_points.write(stable_tax_basis_points);
        storage.mint_burn_fee_basis_points.write(mint_burn_fee_basis_points);
        storage.swap_fee_basis_points.write(swap_fee_basis_points);
        storage.stable_swap_fee_basis_points.write(stable_swap_fee_basis_points);
        storage.margin_fee_basis_points.write(margin_fee_basis_points);
        storage.liquidation_fee_usd.write(liquidation_fee_usd);
        storage.min_profit_time.write(min_profit_time);
        storage.has_dynamic_fees.write(has_dynamic_fees);
 
        log(SetFees {
            tax_basis_points,
            stable_tax_basis_points,
            mint_burn_fee_basis_points,
            swap_fee_basis_points,
            stable_swap_fee_basis_points,
            margin_fee_basis_points,
            liquidation_fee_usd,
            min_profit_time,
            has_dynamic_fees
        });
    }

    #[storage(read, write)]
    fn set_asset_config(
        asset: AssetId,
        asset_decimals: u8,
        asset_weight: u64,
        min_profit_bps: u64,
        max_rusd_amount: u256,
        is_stable: bool,
        is_shortable: bool
    ) {
        _only_gov();

        // increment token count for the first time
        if !storage.whitelisted_assets.get(asset).try_read().unwrap_or(false) {
            storage.whitelisted_asset_count.write(storage.whitelisted_asset_count.read() + 1);
            storage.all_whitelisted_assets.push(asset);
        }

        let total_asset_weights = storage.total_asset_weights.read() - storage.asset_weights.get(asset).try_read().unwrap_or(0);

        storage.whitelisted_assets.insert(asset, true);
        storage.asset_decimals.insert(asset, asset_decimals);
        storage.asset_weights.insert(asset, asset_weight);
        storage.min_profit_basis_points.insert(asset, min_profit_bps);
        storage.max_rusd_amounts.insert(asset, max_rusd_amount);
        storage.stable_assets.insert(asset, is_stable);
        storage.shortable_assets.insert(asset, is_shortable);

        storage.total_asset_weights.write(total_asset_weights + asset_weight);

        log(SetAssetConfig {
            asset,
            asset_decimals,
            asset_weight,
            min_profit_bps,
            max_rusd_amount,
            is_stable,
            is_shortable
        });
    }

    #[storage(read, write)]
    fn clear_asset_config(asset: AssetId) {
        _only_gov();

        require(
            storage.whitelisted_assets.get(asset).try_read().unwrap_or(false),
            Error::VaultStorageAssetNotWhitelisted
        );

        // `asset_weights` is guaranteed to have a value, hence no need to gracefully unwrap
        let prev_asset_weight = storage.asset_weights.get(asset).read();
        storage.total_asset_weights.write(storage.total_asset_weights.read() - prev_asset_weight);

        storage.whitelisted_assets.remove(asset);
        storage.asset_decimals.remove(asset);
        storage.asset_weights.remove(asset);
        storage.min_profit_basis_points.remove(asset);
        storage.max_rusd_amounts.remove(asset);
        storage.stable_assets.remove(asset);
        storage.shortable_assets.remove(asset);

        storage.whitelisted_asset_count.write(storage.whitelisted_asset_count.read() - 1);

        log(ClearAssetConfig { asset });
    }

    #[storage(write)]
    fn set_max_global_short_size(asset: AssetId, max_global_short_size: u256) {
        _only_gov();
        storage.max_global_short_sizes.insert(asset, max_global_short_size);
        log(SetMaxGlobalShortSize { asset, max_global_short_size });
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn has_dynamic_fees() -> bool {
        storage.has_dynamic_fees.read()
    }

    #[storage(read)]
    fn get_min_profit_time() -> u64 {
        storage.min_profit_time.read()
    }

    #[storage(read)]
    fn get_liquidation_fee_usd() -> u256 {
        storage.liquidation_fee_usd.read()
    }

    #[storage(read)]
    fn get_tax_basis_points() -> u64 {
        storage.tax_basis_points.read()
    }

    #[storage(read)]
    fn get_stable_tax_basis_points() -> u64 {
        storage.stable_tax_basis_points.read()
    }

    #[storage(read)]
    fn get_mint_burn_fee_basis_points() -> u64 {
        storage.mint_burn_fee_basis_points.read()
    }

    #[storage(read)]
    fn get_swap_fee_basis_points() -> u64 {
        storage.swap_fee_basis_points.read()
    }

    #[storage(read)]
    fn get_stable_swap_fee_basis_points() -> u64 {
        storage.stable_swap_fee_basis_points.read()
    }

    #[storage(read)]
    fn get_margin_fee_basis_points() -> u64 {
        storage.margin_fee_basis_points.read()
    }

    #[storage(read)]
    fn get_router() -> ContractId {
        storage.router.read()
    }

    #[storage(read)]
    fn get_rusd_contr() -> ContractId {
        storage.rusd_contr.read()
    }

    #[storage(read)]
    fn get_rusd() -> AssetId {
        storage.rusd.read()
    }

    #[storage(read)]
    fn get_pricefeed_provider() -> ContractId {
        storage.pricefeed_provider.read()
    }

    #[storage(read)]
    fn get_total_asset_weights() -> u64 {
        storage.total_asset_weights.read()
    }

    #[storage(read)]
    fn is_approved_router(account1: Account, account2: Account) -> bool {
        storage.approved_routers
            .get(account1).get(account2).try_read().unwrap_or(false)
    }

    #[storage(read)]
    fn is_liquidator(account: Account) -> bool {
        storage.is_liquidator
            .get(account).try_read().unwrap_or(false)
    }

    #[storage(read)]
    fn get_all_whitelisted_assets_length() -> u64 {
        storage.all_whitelisted_assets.len()
    }

    #[storage(read)]
    fn get_whitelisted_asset_by_index(index: u64) -> AssetId {
        if index >= storage.all_whitelisted_assets.len() {
            return ZERO_ASSET;
        }

        storage.all_whitelisted_assets.get(index).unwrap().read()
    }

    #[storage(read)]
    fn get_whitelisted_asset_count() -> u64 {
        storage.whitelisted_asset_count.read()
    }

    #[storage(read)]
    fn is_asset_whitelisted(asset: AssetId) -> bool {
        storage.whitelisted_assets
            .get(asset).try_read().unwrap_or(false)
    }

    #[storage(read)]
    fn get_asset_decimals(asset: AssetId) -> u8 {
        storage.asset_decimals
            .get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_min_profit_basis_points(asset: AssetId) -> u64 {
        storage.min_profit_basis_points
            .get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn is_stable_asset(asset: AssetId) -> bool {
        storage.stable_assets
            .get(asset).try_read().unwrap_or(false)
    }

    #[storage(read)]
    fn is_shortable_asset(asset: AssetId) -> bool {
        storage.shortable_assets
            .get(asset).try_read().unwrap_or(false)
    }

    #[storage(read)]
    fn get_asset_weight(asset: AssetId) -> u64 {
        storage.asset_weights
            .get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_max_rusd_amount(asset: AssetId) -> u256 {
        storage.max_rusd_amounts
            .get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_buffer_amounts(asset: AssetId) -> u256 {
        storage.buffer_amounts
            .get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_last_funding_times(asset: AssetId) -> u64 {
        storage.last_funding_times
            .get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_position_by_key(position_key: b256) -> Position {
        storage.positions
            .get(position_key).try_read().unwrap_or(Position::default())
    }

    #[storage(read)]
    fn get_fee_reserves(asset: AssetId) -> u256 {
        storage.fee_reserves
            .get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_global_short_average_prices(asset: AssetId) -> u256 {
        storage.global_short_average_prices
            .get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_max_global_short_sizes(asset: AssetId) -> u256 {
        storage.max_global_short_sizes
            .get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_redemption_amount(
        asset: AssetId, 
        rusd_amount: u256
    ) -> u256 {
        _get_redemption_amount(asset, rusd_amount)
    }

    #[storage(read)]
    fn get_target_rusd_amount(asset: AssetId) -> u256 {
        _get_target_rusd_amount(asset)
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

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(write)]
    fn set_approved_router(
        router: Account, 
        is_active: bool
    ) {
        let sender = get_sender();
        storage.approved_routers
            .get(sender).insert(router, is_active);
        log(SetApprovedRouter { sender, router, is_active });
    }

    #[storage(write)]
    fn write_last_funding_time(
        asset: AssetId, 
        last_funding_time: u64
    ) {
        _only_write_authorized();

        storage.last_funding_times.insert(asset, last_funding_time);
        log(WriteLastFundingTime { asset, last_funding_time });
    }

    #[storage(write)]
    fn write_position(
        position_key: b256, 
        position: Position
    ) {
        _only_write_authorized();

        storage.positions.insert(position_key, position);
        log(WritePosition { position_key, position });
    }

    #[storage(write)]
    fn write_fee_reserve(
        asset: AssetId, 
        fee_reserve: u256
    ) {
        _only_write_authorized();

        storage.fee_reserves.insert(asset, fee_reserve);
        log(WriteFeeReserve { asset, fee_reserve });
    }

    #[storage(write)]
    fn write_global_short_average_price(
        asset: AssetId, 
        global_short_average_price: u256
    ) {
        _only_write_authorized();

        storage.global_short_average_prices.insert(asset, global_short_average_price);
        log(WriteGlobalShortAveragePrice { asset, global_short_average_price });
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
    require(get_sender() == storage.gov.read(), Error::VaultStorageForbiddenNotGov);
}

#[storage(read)]
fn _only_write_authorized() {
    require(
        storage.is_write_authorized
            .get(get_sender()).try_read().unwrap_or(false), 
        Error::VaultStorageOnlyAuthorizedEntity
    );
}

#[storage(read, write)]
fn _initialize(
    gov: Account,
    rusd_contr: ContractId,
    rusd: AssetId,
    pricefeed_provider: ContractId,
) {
    require(!storage.is_initialized.read(), Error::VaultStorageAlreadyInitialized);
    storage.is_initialized.write(true);
    
    require(
        rusd == AssetId::new(rusd_contr, ZERO),
        Error::VaultStorageInvalidRUSDAsset
    );

    storage.gov.write(gov);
    storage.rusd_contr.write(rusd_contr);
    storage.rusd.write(rusd);
    storage.pricefeed_provider.write(pricefeed_provider);

    log(SetGov { gov });
    log(SetPricefeedProvider { pricefeed: pricefeed_provider });
}

#[storage(read)]
fn _get_redemption_amount(asset: AssetId, rusd_amount: u256) -> u256 {
    let price = _get_max_price(asset);
    let redemption_amount = rusd_amount * PRICE_PRECISION / price;

    let rusd = storage.rusd.read();
    _adjust_for_decimals(redemption_amount, rusd, asset)
}

#[storage(read)]
fn _get_target_rusd_amount(asset: AssetId) -> u256 {
    let supply = abi(RUSD, storage.rusd_contr.read().into()).total_supply();
    if supply == 0 {
        return 0;
    }

    let weight = storage.asset_weights.get(asset).try_read().unwrap_or(0);

    (weight * supply / storage.total_asset_weights.read()).as_u256()
}

#[storage(read)]
fn _adjust_for_decimals(
    amount: u256, 
    asset_div: AssetId, 
    asset_mul: AssetId
) -> u256 {
    let rusd = storage.rusd.read();
    let decimals_div = if asset_div == rusd {
        RUSD_DECIMALS
    } else {
        storage.asset_decimals.get(asset_div).try_read().unwrap_or(0)
    };

    let decimals_mul = if asset_mul == rusd {
        RUSD_DECIMALS
    } else {
        storage.asset_decimals.get(asset_mul).try_read().unwrap_or(0)
    };

    // this should fail if there's some weird stack overflow error
    require(
        decimals_div != 0 || decimals_mul != 0,
        Error::VaultStorageDecimalsAreZero
    );

    amount * 10.pow(decimals_mul.as_u32()).as_u256() / 10.pow(decimals_div.as_u32()).as_u256()
}

#[storage(read)]
fn _asset_to_usd_min(asset: AssetId, asset_amount: u256) -> u256 {
    if asset_amount == 0 {
        return 0;
    }

    let price = _get_min_price(asset);
    let decimals = storage.asset_decimals.get(asset).try_read().unwrap_or(0);

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
    require(price != 0, Error::VaultStoragePriceQueriedIsZero);

    if usd_amount == 0 {
        return 0;
    }

    let decimals = storage.asset_decimals.get(asset).try_read().unwrap_or(0);

    (usd_amount * 10.pow(decimals.as_u32()).as_u256()) / price
}

#[storage(read)]
fn _get_max_price(asset: AssetId) -> u256 {
    let vault_pricefeed = abi(VaultPricefeed, storage.pricefeed_provider.read().into());
    vault_pricefeed.get_price(
        asset, 
        true,
    )
}

#[storage(read)]
fn _get_min_price(asset: AssetId) -> u256 {
    let vault_pricefeed = abi(VaultPricefeed, storage.pricefeed_provider.read().into());
    vault_pricefeed.get_price(
        asset, 
        false,
    )
}