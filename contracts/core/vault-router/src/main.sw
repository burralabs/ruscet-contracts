// SPDX-License-Identifier: Apache-2.0
contract;

mod events;
mod errors;

/*
__     __          _ _     ____             _
\ \   / /_ _ _   _| | |_  |  _ \ ___  _   _| |_ ___ _ __ 
 \ \ / / _` | | | | | __| | |_) / _ \| | | | __/ _ \ '__|
  \ V / (_| | |_| | | |_  |  _ < (_) | |_| | ||  __/ |
   \_/ \__,_|\__,_|_|\__| |_| \_\___/ \__,_|\__\___|_|
*/

use std::{
    call_frames::msg_asset_id,
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
use sway_libs::reentrancy::*;
use helpers::{
    context::*, 
    utils::*,
    signed_256::*,
    zero::*
};
use core_interfaces::{
    vault_router::VaultRouter,
    vault_rusd::VaultRusd,
    vault_position::VaultPosition,
    vault::Vault
};
use errors::*;
use events::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,

    vault_storage: ContractId = ZERO_CONTRACT,
    vault_utils: ContractId = ZERO_CONTRACT,
    vault: ContractId = ZERO_CONTRACT,
    vault_rusd: ContractId = ZERO_CONTRACT,
    vault_position: ContractId = ZERO_CONTRACT,

    lock: bool = false,

    is_initialized: bool = false,
}

impl VaultRouter for Contract {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault_storage: ContractId,
        vault_utils: ContractId,
        vault: ContractId,
        vault_rusd: ContractId,
        vault_position: ContractId
    ) {
        require(
            !storage.is_initialized.read(), 
            Error::VaultRouterAlreadyInitialized
        );
        storage.is_initialized.write(true);

        storage.gov.write(gov);
        storage.vault_storage.write(vault_storage);
        storage.vault_utils.write(vault_utils);
        storage.vault.write(vault);
        storage.vault_rusd.write(vault_rusd);
        storage.vault_position.write(vault_position);

        log(SetGov { gov });
        log(SetVaultStorage { vault_storage });
        log(SetVaultUtils { vault_utils });
        log(SetVault { vault });
        log(SetVaultRusd { vault_rusd });
        log(SetVaultPosition { vault_position });
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|
    */
    #[storage(read, write)]
    fn set_gov(gov: Account) {
        _only_gov();
        storage.gov.write(gov);
        log(SetGov { gov });
    }

    #[storage(read, write)]
    fn set_vault_storage(vault_storage: ContractId) {
        _only_gov();
        storage.vault_storage.write(vault_storage);
        log(SetVaultStorage { vault_storage });
    }

    #[storage(read, write)]
    fn set_vault_utils(vault_utils: ContractId) {
        _only_gov();
        storage.vault_utils.write(vault_utils);
        log(SetVaultUtils { vault_utils });
    }

    #[storage(read, write)]
    fn set_vault(vault: ContractId) {
        _only_gov();
        storage.vault.write(vault);
        log(SetVault { vault });
    }

    #[storage(read, write)]
    fn set_vault_rusd(vault_rusd: ContractId) {
        _only_gov();
        storage.vault_rusd.write(vault_rusd);
        log(SetVaultRusd { vault_rusd });
    }

    #[storage(read, write)]
    fn set_vault_position(vault_position: ContractId) {
        _only_gov();
        storage.vault_position.write(vault_position);
        log(SetVaultPosition { vault_position });
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

    #[storage(read)]
    fn get_vault() -> ContractId {
        storage.vault.read()
    }

    #[storage(read)]
    fn get_vault_rusd() -> ContractId {
        storage.vault_rusd.read()
    }

    #[storage(read)]
    fn get_vault_position() -> ContractId {
        storage.vault_position.read()
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn withdraw_fees(
        asset: AssetId,
        receiver: Account
    ) {
        require(!storage.lock.read(), Error::VaultRouterNonReentrant);
        storage.lock.write(true);

        let vault_rusd = abi(VaultRusd, storage.vault_rusd.read().into());
        vault_rusd.withdraw_fees(
            asset, 
            receiver, 
            get_sender()
        );

        storage.lock.write(false);
    }

    #[payable]
    #[storage(read, write)]
    fn direct_pool_deposit(asset: AssetId) {
        require(!storage.lock.read(), Error::VaultRouterNonReentrant);
        storage.lock.write(true);
        
        let vault_rusd = abi(VaultRusd, storage.vault_rusd.read().into());
        vault_rusd.direct_pool_deposit{
            asset_id: msg_asset_id().into(),
            coins: msg_amount()
        }(
            asset,
        );

        storage.lock.write(false);
    }

    #[payable]
    #[storage(read, write)]
    fn buy_rusd(asset: AssetId, receiver: Account) -> u256 {
        require(!storage.lock.read(), Error::VaultRouterNonReentrant);
        storage.lock.write(true);
        
        let vault_rusd = abi(VaultRusd, storage.vault_rusd.read().into());
        let amount_out = vault_rusd.buy_rusd{
            asset_id: msg_asset_id().into(),
            coins: msg_amount()
        }(
            asset,
            receiver,
        );

        storage.lock.write(false);

        amount_out
    }

    #[payable]
    #[storage(read, write)]
    fn sell_rusd(asset: AssetId, receiver: Account) -> u256 {
        require(!storage.lock.read(), Error::VaultRouterNonReentrant);
        storage.lock.write(true);

        let vault_rusd = abi(VaultRusd, storage.vault_rusd.read().into());
        let amount_out = vault_rusd.sell_rusd{
            asset_id: msg_asset_id().into(),
            coins: msg_amount()
        }(
            asset,
            receiver,
        );

        storage.lock.write(false);

        amount_out
    }

    #[payable]
    #[storage(read, write)]
    fn swap(
        asset_in: AssetId,
        asset_out: AssetId,
        receiver: Account
    ) -> u64 {
        require(!storage.lock.read(), Error::VaultRouterNonReentrant);
        storage.lock.write(true);

        let vault_rusd = abi(VaultRusd, storage.vault_rusd.read().into());
        let amount_out = vault_rusd.swap{
            asset_id: msg_asset_id().into(),
            coins: msg_amount()
        }(
            asset_in,
            asset_out,
            receiver,
        );

        storage.lock.write(false);

        amount_out
    }

    #[payable]
    #[storage(read, write)]
    fn increase_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId, 
        size_delta: u256,
        is_long: bool,
    ) {
        require(!storage.lock.read(), Error::VaultRouterNonReentrant);
        storage.lock.write(true);

        let vault_position = abi(VaultPosition, storage.vault_position.read().into());
        vault_position.increase_position{
            asset_id: msg_asset_id().into(),
            coins: msg_amount()
        }(
            account,
            collateral_asset,
            index_asset,
            size_delta,
            is_long,
            get_sender()
        );

        storage.lock.write(false);
    }

    #[storage(read, write)]
    fn decrease_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account
    ) -> u256 {
        require(!storage.lock.read(), Error::VaultRouterNonReentrant);
        storage.lock.write(true);

        let vault_position = abi(VaultPosition, storage.vault_position.read().into());
        let amount_out = vault_position.decrease_position(
            account,
            collateral_asset,
            index_asset,
            collateral_delta,
            size_delta,
            is_long,
            receiver,
            get_sender()
        );

        storage.lock.write(false);

        amount_out
    }

    #[storage(read, write)]
    fn liquidate_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        fee_receiver: Account
    ) {
        require(!storage.lock.read(), Error::VaultRouterNonReentrant);
        storage.lock.write(true);

        let vault_position = abi(VaultPosition, storage.vault_position.read().into());
        vault_position.liquidate_position(
            account,
            collateral_asset,
            index_asset,
            is_long,
            fee_receiver,
            get_sender()
        );

        storage.lock.write(false);
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
    require(get_sender() == storage.gov.read(), Error::VaultRouterForbiddenNotGov);
}