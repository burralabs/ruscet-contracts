// SPDX-License-Identifier: Apache-2.0
contract;

mod internals;
mod utils;
mod events;
mod constants;
mod errors;

/*
__     __          _ _   
\ \   / /_ _ _   _| | |_ 
 \ \ / / _` | | | | | __|
  \ V / (_| | |_| | | |_ 
   \_/ \__,_|\__,_|_|\__|
*/

use std::{
    block::timestamp,
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
    vault::Vault,
    vault_utils::VaultUtils,
    vault_storage::{
        VaultStorage,
        Position,
        PositionKey,
    },
    vault_pricefeed::VaultPricefeed,
};
use asset_interfaces::rusd::RUSD;
use internals::*;
use utils::*;
use events::*;
use constants::*;
use errors::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,

    vault_storage: ContractId = ZERO_CONTRACT,
    vault_utils: ContractId = ZERO_CONTRACT,

    is_initialized: bool = false,
}

impl Vault for Contract {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault_utils: ContractId,
        vault_storage: ContractId,
    ) {
        require(!storage.is_initialized.read(), Error::VaultAlreadyInitialized);
        storage.is_initialized.write(true);

        storage.gov.write(gov);
        storage.vault_utils.write(vault_utils);
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

    #[storage(read)]
    fn withdraw_fees(
        asset: AssetId,
        receiver: Account 
    ) {
        _only_gov();

        let vault_storage_ = storage.vault_storage.read();
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
            vault_storage_
        );

        log(WithdrawFees {
            asset,
            receiver,
            amount
        });
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
    fn get_vault_storage() -> ContractId {
        storage.vault_storage.read()
    }

    #[storage(read)]
    fn get_vault_utils() -> ContractId {
        storage.vault_utils.read()
    }

    fn get_position_key(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
    ) -> b256 {
        _get_position_key(
            account,
            collateral_asset,
            index_asset,
            is_long
        )
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read)]
    fn update_cumulative_funding_rate(collateral_asset: AssetId, index_asset: AssetId) {
        let vault_utils = abi(VaultUtils, storage.vault_utils.read().into());
        vault_utils.update_cumulative_funding_rate(collateral_asset, index_asset);
    }

    #[payable]
    #[storage(read)]
    fn direct_pool_deposit(asset: AssetId) {
        // deposit into the pool without minting RUSD tokens
        // useful in allowing the pool to become over-collaterised
        let vault_storage_ = storage.vault_storage.read();
        let vault_storage = abi(VaultStorage, vault_storage_.into());
        let vault_utils = abi(VaultUtils, storage.vault_utils.read().into());
        
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
    
    #[storage(read)]
    fn buy_rusd(asset: AssetId, receiver: Account) -> u256 {
        require(
            receiver.non_zero(),
            Error::VaultReceiverCannotBeZero
        );

        _validate_manager();

        let vault_storage_ = storage.vault_storage.read();
        let vault_utils_ = storage.vault_utils.read();
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

        let fee_basis_points = _get_buy_rusd_fee_basis_points(
            asset,
            rusd_amount
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

    #[storage(read)]
    fn sell_rusd(asset: AssetId, receiver: Account) -> u256 {
        require(
            receiver.non_zero(),
            Error::VaultReceiverCannotBeZero
        );

        _validate_manager();

        let vault_storage_ = storage.vault_storage.read();
        let vault_utils_ = storage.vault_utils.read();
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
        _update_asset_balance(rusd);

        let fee_basis_points = _get_sell_rusd_fee_basis_points(
            asset,
            rusd_amount,
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

    #[payable]
    #[storage(read)]
    fn swap(
        asset_in: AssetId,
        asset_out: AssetId,
        receiver: Account
    ) -> u64 {
        _swap(
            asset_in,
            asset_out,
            receiver,
            storage.vault_storage.read(),
            storage.vault_utils.read()
        )
    }

    #[payable]
    #[storage(read)]
    fn increase_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId, 
        size_delta: u256,
        is_long: bool,
    ) {
        _increase_position(
            account,
            collateral_asset,
            index_asset,
            size_delta,
            is_long,
            storage.vault_storage.read(),
            storage.vault_utils.read(),
        );
    }

    #[storage(read)]
    fn decrease_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account
    ) -> u256 {
        _decrease_position(
            account,
            collateral_asset,
            index_asset,
            collateral_delta,
            size_delta,
            is_long,
            receiver,
            true,
            storage.vault_storage.read(),
            storage.vault_utils.read(),
        )
    }

    #[storage(read)]
    fn liquidate_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        fee_receiver: Account
    ) {
        _liquidate_position(
            account,
            collateral_asset,
            index_asset,
            is_long,
            fee_receiver,
            storage.vault_storage.read(),
            storage.vault_utils.read()
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
fn _validate_manager() {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    if vault_storage.get_in_manager_mode() {
        require(
            vault_storage.get_is_manager(get_sender()),
            Error::VaultForbiddenNotManager
        );
    }
}

#[storage(read)]
fn _update_asset_balance(asset: AssetId) {
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    let next_balance = balance_of(ContractId::this(), asset);
    vault_storage.write_asset_balance(asset, next_balance);
}

#[storage(read)]
fn _get_buy_rusd_fee_basis_points(
    asset: AssetId,
    rusd_amount: u256,
) -> u256 {
    let vault_utils = abi(VaultUtils, storage.vault_utils.read().into());
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    vault_utils.get_fee_basis_points(
        asset,
        rusd_amount,
        vault_storage.get_mint_burn_fee_basis_points().as_u256(),
        vault_storage.get_tax_basis_points().as_u256(),
        true
    )
}

#[storage(read)]
fn _get_sell_rusd_fee_basis_points(
    asset: AssetId,
    rusd_amount: u256
) -> u256 {
    let vault_utils = abi(VaultUtils, storage.vault_utils.read().into());
    let vault_storage = abi(VaultStorage, storage.vault_storage.read().into());

    vault_utils.get_fee_basis_points(
        asset,
        rusd_amount,
        vault_storage.get_mint_burn_fee_basis_points().as_u256(),
        vault_storage.get_tax_basis_points().as_u256(),
        false
    )
}