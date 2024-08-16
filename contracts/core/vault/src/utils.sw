// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    context::*,
    primitive_conversions::{
        u8::*,
        u64::*,
    }
};
use std::hash::*;
use core_interfaces::{
    vault_utils::VaultUtils,
    vault_storage::{
        VaultStorage,
        Position,
        PositionKey,
    },
};
use helpers::{
    time::get_unix_timestamp,
    context::*, 
    utils::*,
    transfer::transfer_assets,
    signed_256::*,
    zero::*
};
use asset_interfaces::rusd::RUSD;
use ::constants::*;
use ::events::*;
use ::errors::*;
use ::internals::*;

pub fn _increase_position(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId, 
    size_delta: u256,
    is_long: bool,
    vault_storage_: ContractId,
    vault_utils_: ContractId
) {
    require(
        account.non_zero(),
        Error::VaultAccountCannotBeZero
    );

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    require(
        vault_storage.is_leverage_enabled(),
        Error::VaultLeverageNotEnabled
    );
    _validate_router(account, vault_storage_);
    _validate_assets(collateral_asset, index_asset, is_long, vault_storage_);

    vault_utils.update_cumulative_funding_rate(collateral_asset, index_asset);
    
    let position_key = _get_position_key(
        account, 
        collateral_asset, 
        index_asset, 
        is_long
    );

    let mut position = vault_storage.get_position_by_key(position_key);

    let price = if is_long {
        vault_utils.get_max_price(index_asset)
    } else {
        vault_utils.get_min_price(index_asset)
    };

    if position.size == 0 {
        position.average_price = price;

        // position is brand new, so register map[position_key] => position for off-chain indexer
        log(RegisterPositionByKey {
            position_key,
            account,
            collateral_asset, 
            index_asset, 
            is_long
        });
    }

    if position.size > 0 && size_delta > 0 {
        position.average_price = _get_next_average_price(
            index_asset,
            position.size,
            position.average_price,
            is_long,
            price,
            size_delta,
            position.last_increased_time,
            vault_utils_
        );
    }

    let fee = _collect_margin_fees(
        account,
        collateral_asset,
        index_asset,
        is_long,
        size_delta,
        position.size,
        position.entry_funding_rate,
        vault_storage_,
        vault_utils_
    );

    let collateral_delta = _transfer_in(collateral_asset, vault_storage_).as_u256();
    let collateral_delta_usd = vault_utils.asset_to_usd_min(collateral_asset, collateral_delta);

    position.collateral = position.collateral + collateral_delta_usd;

    require(
        position.collateral >= fee,
        Error::VaultInsufficientCollateralForFees
    );
    position.collateral = position.collateral - fee;
    position.entry_funding_rate = vault_utils.get_entry_funding_rate(
        collateral_asset,
        index_asset,
        is_long
    );
    position.size = position.size + size_delta;
    position.last_increased_time = get_unix_timestamp();

    require(
        position.size > 0,
        Error::VaultInvalidPositionSize
    );

    _validate_position(position.size, position.collateral);
    // we need to have a storage write here because _validate_liquidation re-constructs the position key and 
    // validates the average_price. If not for this position write, it would receive a stale avg price (could be 0)
    vault_storage.write_position(position_key, position);
    vault_utils.validate_liquidation(
        account,
        collateral_asset,
        index_asset,
        is_long,
        true 
    );

    // reserve assets to pay profits on the position
    let reserve_delta = vault_utils.usd_to_asset_max(collateral_asset, size_delta);
    position.reserve_amount = position.reserve_amount + reserve_delta;
    vault_utils.increase_reserved_amount(collateral_asset, reserve_delta);

    if is_long {
        // guaranteed_usd stores the sum of (position.size - position.collateral) for all positions
        // if a fee is charged on the collateral then guaranteed_usd should be increased by that 
        // fee amount since (position.size - position.collateral) would have increased by `fee`
        vault_utils.increase_guaranteed_usd(collateral_asset, size_delta + fee);
        vault_utils.decrease_guaranteed_usd(collateral_asset, collateral_delta_usd);

        // treat the deposited collateral as part of the pool
        vault_utils.increase_pool_amount(collateral_asset, collateral_delta);

        // fees need to be deducted from the pool since fees are deducted from position.collateral
        // and collateral is treated as part of the pool
        vault_utils.decrease_pool_amount(
            collateral_asset, 
            vault_utils.usd_to_asset_min(collateral_asset, fee)
        );
    } else {
        let global_short_size = vault_utils.get_global_short_sizes(index_asset);
        if global_short_size == 0 {
            vault_storage.write_global_short_average_price(index_asset, price);
        } else {
            let new_price = _get_next_global_short_average_price(
                index_asset,
                price,
                size_delta,
                vault_storage_,
                vault_utils_
            );

            vault_storage.write_global_short_average_price(index_asset, new_price);
        }

        vault_utils.increase_global_short_size(index_asset, size_delta);
    }

    log(IncreasePosition {
        key: position_key,
        account,
        collateral_asset,
        index_asset,
        collateral_delta: collateral_delta_usd,
        size_delta,
        is_long,
        price,
        fee,
    });

    log(UpdatePosition {
        key: position_key,
        size: position.size,
        collateral: position.collateral,
        average_price: position.average_price,
        entry_funding_rate: position.entry_funding_rate,
        reserve_amount: position.reserve_amount,
        realized_pnl: position.realized_pnl,
        mark_price: price,
    });

    vault_storage.write_position(position_key, position);
}

pub fn _decrease_position(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    collateral_delta: u256,
    size_delta: u256,
    is_long: bool,
    receiver: Account,
    should_validate_router: bool,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
) -> u256 {
    require(
        account.non_zero(),
        Error::VaultAccountCannotBeZero
    );

    if should_validate_router {
        _validate_router(account, vault_storage_);
    }

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    vault_utils.update_cumulative_funding_rate(collateral_asset, index_asset);

    let position_key = _get_position_key(
        account, 
        collateral_asset, 
        index_asset, 
        is_long
    );
    let mut position = vault_storage.get_position_by_key(position_key);
    require(position.size > 0, Error::VaultEmptyPosition);
    require(position.size >= size_delta, Error::VaultPositionSizeExceeded);
    require(position.collateral >= collateral_delta, Error::VaultPositionCollateralExceeded);

    let collateral = position.collateral;

    let reserve_delta = position.reserve_amount * size_delta / position.size;
    position.reserve_amount = position.reserve_amount - reserve_delta;
    // update storage because the above changes are ignored by call to other fn `_reduce_collateral`
    vault_storage.write_position(position_key, position);

    vault_utils.decrease_reserved_amount(collateral_asset, reserve_delta);

    let (usd_out, usd_out_after_fee) = _reduce_collateral(
        account,
        collateral_asset,
        index_asset,
        collateral_delta,
        size_delta,
        is_long,
        vault_storage_,
        vault_utils_,
    );
    // re-initialize position here because storage was updated in `_reduce_collateral`
    position = vault_storage.get_position_by_key(position_key);

    if position.size != size_delta {
        position.entry_funding_rate = vault_utils.get_entry_funding_rate(collateral_asset, index_asset, is_long);
        position.size = position.size - size_delta;

        _validate_position(position.size, position.collateral);
        // update storage because the above changes are ignored by call to other fn `validate_liquidation`
        // we need to have a storage write here because _validate_liquidation re-constructs the position key and 
        // validates the max_leverage. If not for this position write, it would receive an incorrect max_leverage error
        vault_storage.write_position(position_key, position);
        vault_utils.validate_liquidation(
            account,
            collateral_asset,
            index_asset,
            is_long,
            true
        );

        if is_long {
            vault_utils.increase_guaranteed_usd(collateral_asset, collateral - position.collateral);
            vault_utils.decrease_guaranteed_usd(collateral_asset, size_delta);
        }

        let price = if is_long {
            vault_utils.get_min_price(index_asset)
        } else {
            vault_utils.get_max_price(index_asset)
        };

        log(DecreasePosition {
            key: position_key,
            account,
            collateral_asset,
            index_asset,
            collateral_delta,
            size_delta,
            is_long,
            price,
            fee: usd_out - usd_out_after_fee,
        });
        log(UpdatePosition {
            key: position_key,
            size: position.size,
            collateral: position.collateral,
            average_price: position.average_price,
            entry_funding_rate: position.entry_funding_rate,
            reserve_amount: position.reserve_amount,
            realized_pnl: position.realized_pnl,
            mark_price: price,
        });

        vault_storage.write_position(position_key, position);
    } else {
        if is_long {
            vault_utils.increase_guaranteed_usd(collateral_asset, collateral);
            vault_utils.decrease_guaranteed_usd(collateral_asset, size_delta);
        }

        let price = if is_long {
            vault_utils.get_min_price(index_asset)
        } else {
            vault_utils.get_max_price(index_asset)
        };

        log(DecreasePosition {
            key: position_key,
            account,
            collateral_asset,
            index_asset,
            collateral_delta,
            size_delta,
            is_long,
            price,
            fee: usd_out - usd_out_after_fee,
        });
        log(ClosePosition {
            key: position_key,
            size: position.size,
            collateral: position.collateral,
            average_price: position.average_price,
            entry_funding_rate: position.entry_funding_rate,
            reserve_amount: position.reserve_amount,
            realized_pnl: position.realized_pnl,
        });

        vault_storage.write_position(position_key, Position::default());
        position = vault_storage.get_position_by_key(position_key);
    }

    if !is_long {
        vault_utils.decrease_global_short_size(index_asset, size_delta);
    }

    if usd_out > 0 {
        if is_long {
            vault_utils.decrease_pool_amount(collateral_asset, vault_utils.usd_to_asset_min(collateral_asset, usd_out));
        }

        let amount_out_after_fees = vault_utils.usd_to_asset_min(collateral_asset, usd_out_after_fee);
 
        // @TODO: potential revert here
        _transfer_out(
            collateral_asset, 
            u64::try_from(amount_out_after_fees).unwrap(), 
            receiver,
            vault_storage_
        );
        
        vault_storage.write_position(position_key, position);

        return amount_out_after_fees;
    }

    0
}

pub fn _reduce_collateral(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    collateral_delta: u256,
    size_delta: u256,
    is_long: bool,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
) -> (u256, u256) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    let position_key = _get_position_key(
        account,
        collateral_asset,
        index_asset,
        is_long 
    );
    let mut position = vault_storage.get_position_by_key(position_key);

    let fee = _collect_margin_fees(
        account,
        collateral_asset,
        index_asset,
        is_long,
        size_delta,
        position.size,
        position.entry_funding_rate,
        vault_storage_,
        vault_utils_
    );

    let (has_profit, delta) = vault_utils.get_delta(
        index_asset,
        position.size,
        position.average_price,
        is_long,
        position.last_increased_time
    );

    let adjusted_delta = size_delta * delta / position.size;

    // transfer profits out
    let mut usd_out = 0;
    if adjusted_delta > 0 {
        if has_profit {
            usd_out = adjusted_delta;
            position.realized_pnl = position.realized_pnl + Signed256::from(adjusted_delta);

            // pay out realized profits from the pool amount for short positions
            if !is_long {
                let token_amount = vault_utils.usd_to_asset_min(collateral_asset, adjusted_delta);
                vault_utils.decrease_pool_amount(collateral_asset, token_amount);
            }
        } else {
            position.collateral = position.collateral - adjusted_delta;

            // transfer realized losses to the pool for short positions
            // realized losses for long positions are not transferred here as
            // _increasePoolAmount was already called in increasePosition for longs
            if !is_long {
                let token_amount = vault_utils.usd_to_asset_min(collateral_asset, adjusted_delta);
                vault_utils.increase_pool_amount(collateral_asset, token_amount);
            }

            position.realized_pnl = position.realized_pnl - Signed256::from(adjusted_delta);
        }
    }

    // reduce the position's collateral by _collateralDelta
    // transfer _collateralDelta out
    if collateral_delta > 0 {
        usd_out += collateral_delta;
        position.collateral = position.collateral - collateral_delta;
    }

    // if the position will be closed, then transfer the remaining collateral out
    if position.size == size_delta {
        usd_out += position.collateral;

        position.collateral = 0;
    }

    // if the usdOut is more than the fee then deduct the fee from the usdOut directly
    // else deduct the fee from the position's collateral
    let mut usd_out_after_fee = usd_out;
    if usd_out > fee {
        usd_out_after_fee = usd_out - fee;
    } else {
        // @notice: in some cases when a position is opened for too long, and when attempting to close this, collateral is ZERO (see above), so subtracting fee throws
        // an ArithmeticOverflow
        position.collateral = position.collateral - fee;
        if is_long {
            let fee_assets = vault_utils.usd_to_asset_min(collateral_asset, fee);
            vault_utils.decrease_pool_amount(collateral_asset, fee_assets);
        }
    }

    vault_storage.write_position(position_key, position);

    log(UpdatePnl {
        key: position_key,
        has_profit,
        delta: adjusted_delta,
    });
    (usd_out, usd_out_after_fee)
}

pub fn _liquidate_position(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    is_long: bool,
    fee_receiver: Account,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
) {
    require(
        account.non_zero(),
        Error::VaultAccountCannotBeZero
    );

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    if vault_storage.in_private_liquidation_mode() {
        require(
            vault_storage.is_liquidator(get_sender()),
            Error::VaultInvalidLiquidator
        );
    }

    // set includeAmmPrice to false to prevent manipulated liquidations
    vault_storage.write_include_amm_price(false);

    vault_utils.update_cumulative_funding_rate(collateral_asset, index_asset);

    let position_key = _get_position_key(
        account, 
        collateral_asset, 
        index_asset, 
        is_long
    );

    let position = vault_storage.get_position_by_key(position_key);
    require(position.size > 0, Error::VaultEmptyPosition);

    let liquidation_fee_usd = vault_storage.get_liquidation_fee_usd();

    let (liquidation_state, margin_fees) = vault_utils.validate_liquidation(
        account,
        collateral_asset,
        index_asset,
        is_long,
        false 
    );
    require(
        liquidation_state != 0,
        Error::VaultPositionCannotBeLiquidated
    );

    if liquidation_state == 2 {
        // max leverage exceeded but there is collateral remaining after deducting losses 
        // so decreasePosition instead
        _decrease_position(
            account,
            collateral_asset,
            index_asset,
            0,
            position.size,
            is_long,
            account,
            false,
            vault_storage_,
            vault_utils_
        );
        vault_storage.write_include_amm_price(true);
        return;
    }

    let fee_assets = vault_utils.usd_to_asset_min(collateral_asset, margin_fees);
    vault_storage.write_fee_reserve(
        collateral_asset,
        vault_storage.get_fee_reserves(collateral_asset) + fee_assets
    );
    log(CollectMarginFees {
        asset: collateral_asset,
        fee_usd: margin_fees,
        fee_assets,
    });

    vault_utils.decrease_reserved_amount(collateral_asset, position.reserve_amount);

    if is_long {
        vault_utils.decrease_guaranteed_usd(collateral_asset, position.size - position.collateral);
        vault_utils.decrease_pool_amount(collateral_asset, vault_utils.usd_to_asset_min(collateral_asset, margin_fees));
    }

    let mark_price = if is_long {
        vault_utils.get_min_price(index_asset)
    } else {
        vault_utils.get_max_price(index_asset)
    };

    log(LiquidatePosition {
        key: position_key,
        account,
        collateral_asset,
        index_asset,
        is_long,
        size: position.size,
        collateral: position.collateral,
        reserve_amount: position.reserve_amount,
        realized_pnl: position.realized_pnl,
        mark_price,
    });

    if !is_long && margin_fees < position.collateral {
        let remaining_collateral = position.collateral - margin_fees;
        vault_utils.increase_pool_amount(
            collateral_asset, 
            vault_utils.usd_to_asset_min(collateral_asset, remaining_collateral)
        );
    }

    if !is_long {
        vault_utils.decrease_global_short_size(index_asset, position.size);
    }

    vault_storage.write_position(position_key, Position::default());

    // pay the fee receiver using the pool, we assume that in general the liquidated amount should be sufficient to cover
    // the liquidation fees
    vault_utils.decrease_pool_amount(
        collateral_asset, 
        vault_utils.usd_to_asset_min(collateral_asset, liquidation_fee_usd)
    );
    _transfer_out(
        collateral_asset, 
        // @TODO: potential revert here
        u64::try_from(vault_utils.usd_to_asset_min(collateral_asset, liquidation_fee_usd)).unwrap(),
        fee_receiver,
        vault_storage_
    );

    vault_storage.write_include_amm_price(true);
}

pub fn _swap(
    asset_in: AssetId,
    asset_out: AssetId,
    receiver: Account,
    vault_storage_: ContractId,
    vault_utils_: ContractId
) -> u64 {
    require(
        receiver.non_zero(),
        Error::VaultReceiverCannotBeZero
    );

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    require(
        vault_storage.is_swap_enabled(),
        Error::VaultSwapsNotEnabled
    );
    require(
        vault_storage.is_asset_whitelisted(asset_in),
        Error::VaultAssetInNotWhitelisted
    );
    require(
        vault_storage.is_asset_whitelisted(asset_out),
        Error::VaultAssetOutNotWhitelisted
    );
    require(asset_in != asset_out, Error::VaultAssetsAreEqual);

    vault_storage.write_use_swap_pricing(true);

    vault_utils.update_cumulative_funding_rate(asset_in, asset_in);
    vault_utils.update_cumulative_funding_rate(asset_out, asset_out);

    let amount_in = _transfer_in(asset_in, vault_storage_).as_u256();
    require(amount_in > 0, Error::VaultInvalidAmountIn);

    let price_in = vault_utils.get_min_price(asset_in);
    let price_out = vault_utils.get_max_price(asset_out);

    let mut amount_out = amount_in * price_in / price_out;
    amount_out = vault_utils.adjust_for_decimals(amount_out, asset_in, asset_out);

    // adjust rusdAmounts by the same rusdAmount as debt is shifted between the assets
    let mut rusd_amount = amount_in * price_in / PRICE_PRECISION;
    let rusd = vault_storage.get_rusd();
    rusd_amount = vault_utils.adjust_for_decimals(rusd_amount, asset_in, rusd);

    let fee_basis_points = _get_swap_fee_basis_points(
        asset_in, 
        asset_out, 
        rusd_amount,
        vault_storage_,
        vault_utils_
    );

    let amount_out_after_fees = _collect_swap_fees(
        asset_out, 
        u64::try_from(amount_out).unwrap(),
        u64::try_from(fee_basis_points).unwrap(),
        vault_storage_,
        vault_utils_
    );

    vault_utils.increase_rusd_amount(asset_in, rusd_amount);
    vault_utils.decrease_rusd_amount(asset_out, rusd_amount);

    vault_utils.increase_pool_amount(asset_in, amount_in);
    vault_utils.decrease_pool_amount(asset_out, amount_out);

    _validate_buffer_amount(asset_out, vault_storage_, vault_utils_);

    _transfer_out(asset_out, amount_out_after_fees, receiver, vault_storage_);

    log(Swap {
        account: receiver,
        asset_in,
        asset_out,
        amount_in,
        amount_out,
        amount_out_after_fees: amount_out_after_fees.as_u256(),
        fee_basis_points,
    });

    vault_storage.write_use_swap_pricing(false);

    amount_out_after_fees
}

pub fn _sell_rusd(
    asset: AssetId, 
    receiver: Account,
    vault_storage_: ContractId,
    vault_utils_: ContractId
) -> u256 {
    require(
        receiver.non_zero(),
        Error::VaultReceiverCannotBeZero
    );

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    _validate_manager(vault_storage_);

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());
    
    require(
        vault_storage.is_asset_whitelisted(asset),
        Error::VaultAssetNotWhitelisted
    );

    vault_storage.write_use_swap_pricing(true);

    let rusd = vault_storage.get_rusd();

    let rusd_amount = _transfer_in(rusd, vault_storage_).as_u256();
    require(rusd_amount > 0, Error::VaultInvalidRusdAmount);

    vault_utils.update_cumulative_funding_rate(asset, asset);

    let redemption_amount = vault_utils.get_redemption_amount(asset, rusd_amount);
    require(redemption_amount > 0, Error::VaultInvalidRedemptionAmount);

    vault_utils.decrease_rusd_amount(asset, rusd_amount);
    vault_utils.decrease_pool_amount(asset, redemption_amount);

    // require rusd_amount to be less than u64::max
    require(
        rusd_amount < u64::max().as_u256(),
        Error::VaultInvalidRUSDBurnAmountGtU64Max
    );

    let _amount = u64::try_from(rusd_amount).unwrap();

    abi(RUSD, vault_storage.get_rusd_contr().into()).burn{
        // @TODO: this is prob a buggy implementation of the RUSD native asset? 
        asset_id: rusd.into(),
        coins: _amount
    }(
        Account::from(ContractId::this()),
        _amount
    );

    // the _transferIn call increased the value of tokenBalances[rusd]
    // usually decreases in token balances are synced by calling _transferOut
    // however, for UDFG, the assets are burnt, so _updateTokenBalance should
    // be manually called to record the decrease in assets
    // update asset balance
    let next_balance = balance_of(ContractId::this(), asset);
    vault_storage.write_asset_balance(asset, next_balance);

    // _get_sell_rusd_fee_basis_points
    let fee_basis_points = vault_utils.get_fee_basis_points(
        asset,
        rusd_amount,
        vault_storage.get_mint_burn_fee_basis_points().as_u256(),
        vault_storage.get_tax_basis_points().as_u256(),
        false
    );
    
    let amount_out = _collect_swap_fees(
        asset, 
        u64::try_from(redemption_amount).unwrap(), 
        u64::try_from(fee_basis_points).unwrap(), 
        vault_storage_,
        vault_utils_,
    );
    require(amount_out > 0, Error::VaultInvalidAmountOut);

    _transfer_out(asset, amount_out, receiver, vault_storage_);

    log(SellRUSD {
        account: receiver,
        asset,
        rusd_amount,
        asset_amount: amount_out,
        fee_basis_points,
    });

    vault_storage.write_use_swap_pricing(false);

    amount_out.as_u256()
}

pub fn _buy_rusd(
    asset: AssetId, 
    receiver: Account,
    vault_storage_: ContractId,
    vault_utils_: ContractId
) -> u256 {
    require(
        receiver.non_zero(),
        Error::VaultReceiverCannotBeZero
    );

    _validate_manager(vault_storage_);

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    require(
        vault_storage.is_asset_whitelisted(asset),
        Error::VaultAssetNotWhitelisted
    );

    vault_storage.write_use_swap_pricing(true);

    let asset_amount = _transfer_in(asset, vault_storage_);
    require(asset_amount > 0, Error::VaultInvalidAssetAmount);

    vault_utils.update_cumulative_funding_rate(asset, asset);

    let price = vault_utils.get_min_price(asset);
    let rusd = vault_storage.get_rusd();

    let mut rusd_amount = asset_amount.as_u256() * price / PRICE_PRECISION;
    rusd_amount = vault_utils.adjust_for_decimals(rusd_amount, asset, rusd);
    require(rusd_amount > 0, Error::VaultInvalidRusdAmount);

    // _get_buy_rusd_fee_basis_points
    let fee_basis_points = vault_utils.get_fee_basis_points(
        asset,
        rusd_amount,
        vault_storage.get_mint_burn_fee_basis_points().as_u256(),
        vault_storage.get_tax_basis_points().as_u256(),
        true
    );

    let amount_after_fees = _collect_swap_fees(
        asset, 
        asset_amount, 
        u64::try_from(fee_basis_points).unwrap(),
        vault_storage_,
        vault_utils_,
    ).as_u256();

    let mut mint_amount = amount_after_fees * price / PRICE_PRECISION;
    mint_amount = vault_utils.adjust_for_decimals(mint_amount, asset, rusd);

    vault_utils.increase_rusd_amount(asset, mint_amount);
    vault_utils.increase_pool_amount(asset, amount_after_fees);

    // require rusd_amount to be less than u64::max
    require(
        mint_amount < u64::max().as_u256(),
        Error::VaultInvalidMintAmountGtU64Max
    );

    let rusd = abi(RUSD, vault_storage.get_rusd_contr().into());
    rusd.mint(
        receiver,
        u64::try_from(mint_amount).unwrap()
    );

    log(BuyRUSD {
        account: receiver,
        asset,
        asset_amount,
        rusd_amount: mint_amount,
        fee_basis_points,
    });

    vault_storage.write_use_swap_pricing(false);

    mint_amount
}

pub fn _direct_pool_deposit(
    asset: AssetId,
    vault_storage_: ContractId,
    vault_utils_: ContractId
) {
    // deposit into the pool without minting RUSD tokens
    // useful in allowing the pool to become over-collaterised
    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());
    
    require(
        vault_storage.is_asset_whitelisted(asset),
        Error::VaultAssetNotWhitelisted
    );

    let amount = _transfer_in(asset, vault_storage_).as_u256();
    // @TODO: check this
    require(amount > 0, Error::VaultInvalidAssetAmount);
    vault_utils.increase_pool_amount(asset, amount);

    log(DirectPoolDeposit {
        asset: asset,
        amount: amount,
    });
}