// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____             _            
|  _ \ ___  _   _| |_ ___ _ __ 
| |_) / _ \| | | | __/ _ \ '__|
|  _ < (_) | |_| | ||  __/ |   
|_| \_\___/ \__,_|\__\___|_|   
*/

mod errors;
use std::{
    block::timestamp,
    call_frames::msg_asset_id,
    context::*,
    revert::require,
};
use std::hash::*;
use core_interfaces::{
    router::Router,
    vault::Vault
};
use helpers::{context::*, utils::*, transfer::*};
use errors::*;

storage {
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    
    rusd: ContractId = ZERO_CONTRACT,
    vault: ContractId = ZERO_CONTRACT,

    plugins: StorageMap<ContractId, bool> = StorageMap::<ContractId, bool> {},
    approved_plugins: StorageMap<(Account, ContractId), bool> 
        = StorageMap::<(Account, ContractId), bool> {},
}

impl Router for Contract {
    #[storage(read, write)]
    fn initialize(
        vault: ContractId,
        rusd: ContractId,
        gov: Account,
    ) {
        require(!storage.is_initialized.read(), Error::RouterAlreadyInitialized);
        storage.is_initialized.write(true);

        storage.gov.write(gov);
        storage.vault.write(vault);
        storage.rusd.write(rusd);
    }

    #[storage(write)]
    fn set_gov(gov: Account) {
        _only_gov();
        storage.gov.write(gov);
    }

    #[storage(write)]
    fn set_plugin(plugin: ContractId, is_active: bool) {
        _only_gov();
        storage.plugins.insert(plugin, is_active);
    }

    #[storage(write)]
    fn set_approved_plugins(plugin: ContractId, is_approved: bool) {
        storage.approved_plugins.insert((get_sender(), plugin), is_approved);
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn is_plugin(plugin: ContractId) -> bool {
        storage.plugins.get(plugin).try_read().unwrap_or(false)
    }

    #[storage(read)]
    fn is_approved_plugin(account: Account, plugin: ContractId) -> bool {
        storage.approved_plugins.get((account, plugin)).try_read().unwrap_or(false)
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[payable]
    #[storage(read)]
    fn plugin_transfer(
        asset: AssetId,
        account: Account,
        receiver: Account,
        amount: u64 
    ) {
        _validate_plugin(account);

        require(
            msg_asset_id() == asset,
            Error::RouterInvalidAssetForwarded
        );

        require(
            msg_amount() == amount,
            Error::RouterInvalidAssetAmount
        );

        transfer_assets(
            asset,
            receiver,
            amount
        );

    }

    #[storage(read)]
    fn plugin_increase_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        size_delta: u256,
        is_long: bool 
    ) {
        _validate_plugin(account);

        abi(Vault, storage.vault.read().into()).increase_position(
            account,
            collateral_asset,
            index_asset,
            size_delta,
            is_long
        );
    }

    #[storage(read)]
    fn plugin_decrease_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account
    ) -> u256 {
        _validate_plugin(account);

        abi(Vault, storage.vault.read().into()).decrease_position(
            account,
            collateral_asset,
            index_asset,
            collateral_delta,
            size_delta,
            is_long,
            receiver
        )
    }

    #[payable]
    #[storage(read)]
    fn direct_pool_deposit(asset: AssetId) {
        require(
            msg_asset_id() == asset,
            Error::RouterInvalidAssetForwarded
        );
        require(
            msg_amount() > 0,
            Error::RouterZeroAssetAmount
        );

        let vault = abi(Vault, storage.vault.read().into());
        vault.direct_pool_deposit{
            asset_id: asset.into(),
            coins: msg_amount()
        }(asset);
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
    require(get_sender() == storage.gov.read(), Error::RouterForbidden);
}

#[storage(read)]
fn _validate_plugin(account: Account) {
    let sender_contract = get_contract_or_revert();
    require(
        storage.plugins.get(sender_contract).try_read().is_some(),
        Error::RouterInvalidPlugin
    );

    require(
        storage.approved_plugins.get((account, sender_contract)).try_read().is_some(),
        Error::RouterPluginNotApproved
    );
}