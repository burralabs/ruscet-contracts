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
        _initialize(gov, vault_utils, vault_storage);
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
        _direct_pool_deposit(
            asset,
            storage.vault_storage.read(),
            storage.vault_utils.read()
        )
    }
    
    #[storage(read)]
    fn buy_rusd(asset: AssetId, receiver: Account) -> u256 {
        _buy_rusd(
            asset,
            receiver,
            storage.vault_storage.read(),
            storage.vault_utils.read()
        )
    }

    #[storage(read)]
    fn sell_rusd(asset: AssetId, receiver: Account) -> u256 {
        _sell_rusd(
            asset,
            receiver,
            storage.vault_storage.read(),
            storage.vault_utils.read()
        )
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

#[storage(read, write)]
fn _initialize(
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