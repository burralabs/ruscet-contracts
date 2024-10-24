// SPDX-License-Identifier: Apache-2.0
contract;

mod errors;
mod events;

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
};
use std::hash::*;
use helpers::{
    context::*,
    transfer::transfer_assets,
    utils::*,
};
use core_interfaces::vault::Vault;
use errors::*;
use events::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,

    is_initialized: bool = false,
    vault_routers: StorageMap<ContractId, bool> = StorageMap {},
}

impl Vault for Contract {
    #[storage(read, write)]
    fn initialize(gov: Account) {
        require(
            !storage.is_initialized.read(), 
            Error::VaultAlreadyInitialized
        );
        storage.is_initialized.write(true);

        storage.gov.write(gov);
        log(SetGov { gov });
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
        log(SetGov { gov: new_gov });
    }

    #[storage(read, write)]
    fn set_vault(vault_router: ContractId, is_active: bool) {
        _only_gov();
        storage.vault_routers.insert(vault_router, is_active);
        log(SetVaultRouter { vault_router, is_active });
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
    fn is_vault_active(vault_router: ContractId) -> bool {
        storage.vault_routers.get(vault_router).try_read().unwrap_or(false)
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    /// Callable only by the VaultRouter
    /// transfer assets from the VaultRouterPool to `receiver`
    #[storage(read)]
    fn transfer_out(
        asset: AssetId,
        amount: u64,
        receiver: Account,
    ) {
        _only_vault_router();

        transfer_assets(
            asset,
            receiver,
            amount
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
fn _only_vault_router() {
    require(
        storage.vault_routers.get(get_contract_or_revert()).try_read().unwrap_or(false),
        Error::VaultForbiddenNotVaultRouter
    );
}