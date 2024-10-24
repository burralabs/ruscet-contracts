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
    vault::Vault,
    vault_storage::{
        VaultStorage,
        Position,
    },
};
use helpers::{
    time::get_unix_timestamp,
    context::*, 
    utils::*,
    signed_256::*,
    zero::*
};
use asset_interfaces::rusd::RUSD;
use ::constants::*;
use ::events::*;
use ::errors::*;
use ::internals::*;

/// deposit into the pool without minting RUSD tokens
/// useful in allowing the pool to become over-collaterised
pub fn _direct_pool_deposit(
    asset: AssetId,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
    vault_: ContractId
) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());
    
    require(
        vault_storage.is_asset_whitelisted(asset),
        Error::VaultRouterAssetNotWhitelisted
    );

    let amount = _transfer_in(asset, vault_).as_u256();
    require(amount > 0, Error::VaultRouterInvalidAssetAmount);

    vault_utils.increase_pool_amount(asset, amount);

    log(DirectPoolDeposit {
        asset: asset,
        amount: amount,
    });
}

pub fn _sell_rusd(
    asset: AssetId, 
    receiver: Account,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
    vault_: ContractId
) -> u256 {
    require(
        receiver.non_zero(),
        Error::VaultRouterReceiverCannotBeZero
    );

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    require(
        vault_storage.is_asset_whitelisted(asset),
        Error::VaultRouterAssetNotWhitelisted
    );

    let rusd = vault_storage.get_rusd();

    let rusd_amount = _transfer_in(rusd, vault_).as_u256();
    require(rusd_amount > 0, Error::VaultRouterInvalidRusdAmount);

    vault_utils.update_cumulative_funding_rate(asset, asset);

    let redemption_amount = vault_storage.get_redemption_amount(asset, rusd_amount);
    require(redemption_amount > 0, Error::VaultRouterInvalidRedemptionAmount);

    vault_utils.decrease_rusd_amount(asset, rusd_amount);
    vault_utils.decrease_pool_amount(asset, redemption_amount);

    // require rusd_amount to be less than u64::max
    require(
        rusd_amount < u64::max().as_u256(),
        Error::VaultRouterInvalidRUSDBurnAmountGtU64Max
    );

    let _amount = u64::try_from(rusd_amount).unwrap();

    // transfer in assets from Vault
    // remove when proper dynamic dispatch is implemented
    let vault = abi(Vault, vault_.into());
    vault.transfer_out(rusd, _amount, Account::from(ContractId::this()));

    let rusd_contr = abi(RUSD, vault_storage.get_rusd_contr().into());
    rusd_contr.burn{
        asset_id: rusd.into(),
        coins: _amount
    }(
        Account::from(ContractId::this()),
        _amount
    );

    // update asset balance
    let _next_balance = balance_of(ContractId::this(), asset);

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
    );
    require(amount_out > 0, Error::VaultRouterInvalidAmountOut);

    _transfer_out(
        asset, 
        amount_out, 
        receiver,
        vault_
    );

    log(SellRUSD {
        account: receiver,
        asset,
        rusd_amount,
        asset_amount: amount_out,
        fee_basis_points,
    });

    amount_out.as_u256()
}

pub fn _buy_rusd(
    asset: AssetId, 
    receiver: Account,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
    vault_: ContractId
) -> u256 {
    require(
        receiver.non_zero(),
        Error::VaultRouterReceiverCannotBeZero
    );

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    require(
        vault_storage.is_asset_whitelisted(asset),
        Error::VaultRouterAssetNotWhitelisted
    );

    let asset_amount = _transfer_in(asset, vault_);
    require(asset_amount > 0, Error::VaultRouterInvalidAssetAmount);

    vault_utils.update_cumulative_funding_rate(asset, asset);

    let price = vault_utils.get_min_price(asset);
    let rusd = vault_storage.get_rusd();

    let mut rusd_amount = asset_amount.as_u256() * price / PRICE_PRECISION;
    rusd_amount = vault_storage.adjust_for_decimals(rusd_amount, asset, rusd);
    require(rusd_amount > 0, Error::VaultRouterInvalidRusdAmount);

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
    ).as_u256();

    let mut mint_amount = amount_after_fees * price / PRICE_PRECISION;
    mint_amount = vault_storage.adjust_for_decimals(mint_amount, asset, rusd);

    vault_utils.increase_rusd_amount(asset, mint_amount);
    vault_utils.increase_pool_amount(asset, amount_after_fees);

    // require rusd_amount to be less than u64::max
    require(
        mint_amount < u64::max().as_u256(),
        Error::VaultRouterInvalidMintAmountGtU64Max
    );

    let rusd = abi(RUSD, vault_storage.get_rusd_contr().into());
    rusd.mint(
        receiver,
        u64::try_from(mint_amount).unwrap(),
    );

    log(BuyRUSD {
        account: receiver,
        asset,
        asset_amount,
        rusd_amount: mint_amount,
        fee_basis_points,
    });

    mint_amount
}

pub fn _withdraw_fees(
    asset: AssetId,
    receiver: Account,
    vault_storage_: ContractId,
    vault_: ContractId
) {
    let vault_storage = abi(VaultStorage, vault_storage_.into());

    let amount = vault_storage.get_fee_reserves(asset);
    if amount == 0 {
        return;
    }

    vault_storage.write_fee_reserve(asset, 0);

    _transfer_out(
        asset,
        u64::try_from(amount).unwrap(),
        receiver,
        vault_
    );

    log(WithdrawFees {
        asset,
        receiver,
        amount
    });
}

pub fn _swap(
    asset_in: AssetId,
    asset_out: AssetId,
    receiver: Account,
    vault_storage_: ContractId,
    vault_utils_: ContractId,
    vault_: ContractId
) -> u64 {
    require(
        receiver.non_zero(),
        Error::VaultRouterReceiverCannotBeZero
    );

    let vault_storage = abi(VaultStorage, vault_storage_.into());
    let vault_utils = abi(VaultUtils, vault_utils_.into());

    require(
        vault_storage.is_asset_whitelisted(asset_in),
        Error::VaultRouterAssetInNotWhitelisted
    );
    require(
        vault_storage.is_asset_whitelisted(asset_out),
        Error::VaultRouterAssetOutNotWhitelisted
    );
    require(asset_in != asset_out, Error::VaultRouterAssetsAreEqual);

    vault_utils.update_cumulative_funding_rate(asset_in, asset_in);
    vault_utils.update_cumulative_funding_rate(asset_out, asset_out);

    let amount_in = _transfer_in(asset_in, vault_).as_u256();
    require(amount_in > 0, Error::VaultRouterInvalidAmountIn);

    let price_in = vault_utils.get_min_price(asset_in);
    let price_out = vault_utils.get_max_price(asset_out);

    let mut amount_out = amount_in * price_in / price_out;
    amount_out = vault_storage.adjust_for_decimals(amount_out, asset_in, asset_out);

    // adjust rusdAmounts by the same rusdAmount as debt is shifted between the assets
    let mut rusd_amount = amount_in * price_in / PRICE_PRECISION;
    let rusd = vault_storage.get_rusd();
    rusd_amount = vault_storage.adjust_for_decimals(rusd_amount, asset_in, rusd);

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
    );

    vault_utils.increase_rusd_amount(asset_in, rusd_amount);
    vault_utils.decrease_rusd_amount(asset_out, rusd_amount);

    vault_utils.increase_pool_amount(asset_in, amount_in);
    vault_utils.decrease_pool_amount(asset_out, amount_out);

    _validate_buffer_amount(asset_out, vault_storage_, vault_utils_);

    _transfer_out(
        asset_out, 
        amount_out_after_fees, 
        receiver,
        vault_
    );

    log(Swap {
        account: receiver,
        asset_in,
        asset_out,
        amount_in,
        amount_out,
        amount_out_after_fees: amount_out_after_fees.as_u256(),
        fee_basis_points,
    });

    amount_out_after_fees
}