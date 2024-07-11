// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____        _                        _   _           _       _            
| __ )  __ _| | __ _ _ __   ___ ___  | | | |_ __   __| | __ _| |_ ___ _ __ 
|  _ \ / _` | |/ _` | '_ \ / __/ _ \ | | | | '_ \ / _` |/ _` | __/ _ \ '__|
| |_) | (_| | | (_| | | | | (_|  __/ | |_| | |_) | (_| | (_| | ||  __/ |   
|____/ \__,_|_|\__,_|_| |_|\___\___|  \___/| .__/ \__,_|\__,_|\__\___|_|   
                                           |_|
*/


use std::{
    block::timestamp,
    call_frames::msg_asset_id,
    context::*,
    revert::require,
    primitive_conversions::u64::*
};
use std::hash::*;
use peripheral_interfaces::balance_updater::BalanceUpdater;
use core_interfaces::{
    vault::Vault,
    vault_storage::VaultStorage,
    vault_utils::VaultUtils
};
use interfaces::wrapped_asset::{
    WrappedAsset as WrappedAssetABI
};
use helpers::{
    context::*, 
    utils::*,
    transfer::*,
    asset::*
};

enum Error {
    BalanceUpdaterInvalidAssetForwarded: (),
    BalanceUpdaterInsufficientAmountForwarded: ()
}

impl BalanceUpdater for Contract {
    #[payable]
    fn update_balance(
        vault_: ContractId,
        asset: AssetId,
        rusd: WrappedAsset,
        rusd_amount: u64
    ) {
        require(
            msg_asset_id() == asset,
            Error::BalanceUpdaterInvalidAssetForwarded
        );

        let vault = abi(Vault, vault_.into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
        let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());

        // @TODO: potential revert here
        let pool_amount = u64::try_from(vault_utils.get_pool_amounts(asset)).unwrap();
        // @TODO: potential revert here
        let fee = u64::try_from(vault_storage.get_fee_reserves(asset)).unwrap();
        let balance = balance_of(vault_, asset);

        let transfer_amount = pool_amount + fee - balance;
        require(
            msg_amount() >= transfer_amount,
            Error::BalanceUpdaterInsufficientAmountForwarded
        );

        transfer_assets(
            asset,
            Account::from(vault_),
            transfer_amount
        );

        _unwrap(rusd, rusd_amount);

        // forward assets to vault
        transfer_assets(
            rusd,
            Account::from(vault_),
            rusd_amount
        );

        let _ = vault.sell_rusd(asset, get_sender());
    }
}

fn _unwrap(
    asset: WrappedAsset,
    amount: u64,
) {
    let asset_to_unwrap = abi(WrappedAssetABI, asset.into());

    // transfer wrapped asset to self
    asset_to_unwrap.transfer_on_behalf_of(
        get_sender(),
        Account::from(ContractId::this()),
        amount
    );

    // unwrap amount
    asset_to_unwrap.withdraw(amount);
}