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

configurable {
    VAULT_STORAGE: ContractId = ZERO_CONTRACT,
    VAULT_UTILS: ContractId = ZERO_CONTRACT
}

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,

    is_initialized: bool = false,
}

impl Vault for Contract {
    #[storage(read, write)]
    fn initialize(gov: Account) {
        require(!storage.is_initialized.read(), Error::VaultAlreadyInitialized);
        storage.is_initialized.write(true);

        storage.gov.write(gov);
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
    }

    #[storage(read)]
    fn withdraw_fees(
        asset: AssetId,
        receiver: Account 
    ) {
        _only_gov();
        _withdraw_fees(asset, receiver, VAULT_STORAGE);
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

    fn get_vault_storage() -> ContractId {
        VAULT_STORAGE
    }

    fn get_vault_utils() -> ContractId {
        VAULT_UTILS
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[payable]
    fn direct_pool_deposit(asset: AssetId) {
        _direct_pool_deposit(
            asset,
            VAULT_STORAGE,
            VAULT_UTILS
        );
    }

    fn buy_rusd(asset: AssetId, receiver: Account) -> u256 {
        _buy_rusd(
            asset,
            receiver,
            VAULT_STORAGE,
            VAULT_UTILS
        )
    }

    fn sell_rusd(asset: AssetId, receiver: Account) -> u256 {
        _sell_rusd(
            asset,
            receiver,
            VAULT_STORAGE,
            VAULT_UTILS
        )
    }

    #[payable]
    fn swap(
        asset_in: AssetId,
        asset_out: AssetId,
        receiver: Account
    ) -> u64 {
        _swap(
            asset_in,
            asset_out,
            receiver,
            VAULT_STORAGE,
            VAULT_UTILS
        )
    }

    #[payable]
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
            VAULT_STORAGE,
            VAULT_UTILS,
        );
    }

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
            VAULT_STORAGE,
            VAULT_UTILS,
        )
    }

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
            VAULT_STORAGE,
            VAULT_UTILS
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