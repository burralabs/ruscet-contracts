// SPDX-License-Identifier: Apache-2.0
contract;

mod internals;
mod utils;
mod events;
mod constants;
mod errors;

/*
__     __          _ _     ____  _   _ ____  ____  
\ \   / /_ _ _   _| | |_  |  _ \| | | / ___||  _ \ 
 \ \ / / _` | | | | | __| | |_) | | | \___ \| | | |
  \ V / (_| | |_| | | |_  |  _ <| |_| |___) | |_| |
   \_/ \__,_|\__,_|_|\__| |_| \_\\___/|____/|____/ 
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
    vault_rusd::VaultRusd,
    vault::Vault
};
use internals::*;
use utils::*;
use events::*;
use constants::*;
use errors::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,

    vault_router: ContractId = ZERO_CONTRACT,
    vault_storage: ContractId = ZERO_CONTRACT,
    vault_utils: ContractId = ZERO_CONTRACT,
    vault: ContractId = ZERO_CONTRACT,

    is_initialized: bool = false,
}

impl VaultRusd for Contract {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault_router: ContractId,
        vault_storage: ContractId,
        vault_utils: ContractId,
        vault: ContractId
    ) {
        require(!storage.is_initialized.read(), Error::VaultRouterAlreadyInitialized);
        storage.is_initialized.write(true);

        storage.gov.write(gov);
        storage.vault_router.write(vault_router);
        storage.vault_storage.write(vault_storage);
        storage.vault_utils.write(vault_utils);
        storage.vault.write(vault);

        log(SetGov { gov });
        log(SetVaultRouter { vault_router });
        log(SetVaultStorage { vault_storage });
        log(SetVaultUtils { vault_utils });
        log(SetVault { vault });
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
    fn set_vault_router(vault_router: ContractId) {
        _only_gov();
        storage.vault_router.write(vault_router);
        log(SetVaultRouter { vault_router });
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
    fn get_vault_router() -> ContractId {
        storage.vault_router.read()
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

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    /// this method withdraws fees from the VaultRouter and sends them to the `receiver`
    /// the call must be made by the `gov` and sent via the `VaultRouter`
    #[storage(read)]
    fn withdraw_fees(
        asset: AssetId,
        receiver: Account,
        tx_sender: Account
    ) {
        _only_vault_router();

        require(
            tx_sender == storage.gov.read(),
            Error::VaultRusdForbiddenNotGov
        );

        _withdraw_fees(
            asset, 
            receiver, 
            storage.vault_storage.read(),
            storage.vault.read()
        );
    }

    #[payable]
    #[storage(read)]
    fn direct_pool_deposit(asset: AssetId) {
        _only_vault_router();
        
        _direct_pool_deposit(
            asset,
            storage.vault_storage.read(),
            storage.vault_utils.read(),
            storage.vault.read()
        );
    }

    /// this call must be batched with a call to `RUSD.set_user_staked_balance`
    /// to get the correct staked balance for the user
    #[payable]
    #[storage(read)]
    fn buy_rusd(
        asset: AssetId, 
        receiver: Account
    ) -> u256 {
        _only_vault_router();
        
        _buy_rusd(
            asset,
            receiver,
            storage.vault_storage.read(),
            storage.vault_utils.read(),
            storage.vault.read()
        )
    }

    /// this call must be batched with a call to `RUSD.set_user_staked_balance`
    /// to get the correct staked balance for the user
    #[payable]
    #[storage(read)]
    fn sell_rusd(
        asset: AssetId, 
        receiver: Account
    ) -> u256 {
        _only_vault_router();

        _sell_rusd(
            asset,
            receiver,
            storage.vault_storage.read(),
            storage.vault_utils.read(),
            storage.vault.read()
        )
    }

    #[payable]
    #[storage(read)]
    fn swap(
        asset_in: AssetId,
        asset_out: AssetId,
        receiver: Account
    ) -> u64 {
        _only_vault_router();

        _swap(
            asset_in,
            asset_out,
            receiver,
            storage.vault_storage.read(),
            storage.vault_utils.read(),
            storage.vault.read()
        )
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
    require(get_sender() == storage.gov.read(), Error::VaultRusdForbiddenNotGov);
}

#[storage(read)]
fn _only_vault_router() {
    require(
        get_contract_or_revert() == storage.vault_router.read(), 
        Error::VaultRusdForbiddenNotVaultRouter
    );
}
