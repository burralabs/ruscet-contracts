// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____           _ _   _               __  __                                   
|  _ \ ___  ___(_) |_(_) ___  _ __   |  \/  | __ _ _ __   __ _  __ _  ___ _ __ 
| |_) / _ \/ __| | __| |/ _ \| '_ \  | |\/| |/ _` | '_ \ / _` |/ _` |/ _ \ '__|
|  __/ (_) \__ \ | |_| | (_) | | | | | |  | | (_| | | | | (_| | (_| |  __/ |   
|_|   \___/|___/_|\__|_|\___/|_| |_| |_|  |_|\__,_|_| |_|\__,_|\__, |\___|_|   
                                                               |___/
*/

mod events;
mod errors;

use std::{
    block::timestamp,
    call_frames::msg_asset_id,
    context::*,
    revert::require,
};
use std::hash::*;
use core_interfaces::{
    position_manager::PositionManager,
    base_position_manager::BasePositionManager,
    vault::Vault,
    router::Router
};
use helpers::{
    context::*,
    utils::*,
    transfer::transfer_assets
};
use events::*;
use errors::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    in_legacy_mode: bool = false,
    should_validator_increase_order: bool = true,
    
    base_position_manager: ContractId = ZERO_CONTRACT,
    vault: ContractId = ZERO_CONTRACT,
    router: ContractId = ZERO_CONTRACT,

    is_order_keeper: StorageMap<Address, bool> = StorageMap::<Address, bool> {},
    is_partner: StorageMap<Address, bool> = StorageMap::<Address, bool> {},
    is_liquidator: StorageMap<Address, bool> = StorageMap::<Address, bool> {},
}

impl PositionManager for Contract {
    #[storage(read, write)]
    fn initialize(
        base_position_manager: ContractId,
        vault: ContractId,
        router: ContractId,
    ) {
        require(!storage.is_initialized.read(), Error::PositionManagerAlreadyInitialized);
        storage.is_initialized.write(true);

        storage.gov.write(get_sender());
        storage.base_position_manager.write(base_position_manager);
        storage.vault.write(vault);
        storage.router.write(router);
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_order_keeper(order_keeper: Address, is_active: bool) {
        _only_gov();

        require(order_keeper != ZERO_ADDRESS, Error::PositionManagerOrderKeeperZero);
        storage.is_order_keeper.insert(order_keeper, is_active);

        log(SetOrderKeeper {
            account: order_keeper,
            is_active
        });
    }

    #[storage(read, write)]
    fn set_liquidator(liquidator: Address, is_active: bool) {
        _only_gov();

        require(liquidator != ZERO_ADDRESS, Error::PositionManagerLiquidatorZero);
        storage.is_liquidator.insert(liquidator, is_active);

        log(SetLiquidator {
            account: liquidator,
            is_active
        });
    }

    #[storage(read, write)]
    fn set_partner(partner: Address, is_active: bool) {
        _only_gov();

        require(partner != ZERO_ADDRESS, Error::PositionManagerPartnerZero);
        storage.is_partner.insert(partner, is_active);

        log(SetPartner {
            account: partner,
            is_active
        });
    }

    #[storage(read, write)]
    fn set_in_legacy_mode(in_legacy_mode: bool) {
        _only_gov();

        storage.in_legacy_mode.write(in_legacy_mode);

        log(SetInLegacyMode { in_legacy_mode });
    }

    #[storage(read, write)]
    fn set_should_validator_increase_order(
        should_validator_increase_order: bool
    ) {
        _only_gov();

        storage.should_validator_increase_order.write(should_validator_increase_order);

        log(SetShouldValidatorIncreaseOrder { should_validator_increase_order });
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_base_position_manager() -> ContractId {
        storage.base_position_manager.read()
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
    fn increase_position(
        path: Vec<AssetId>,
        index_asset: AssetId,
        amount_in_: u64,
        min_out: u64,
        size_delta: u256,
        is_long: bool,
        price: u256
    ) {
        _only_partners_or_legacy_mode();

        require(
            path.len() == 1 || path.len() == 2,
            Error::PositionManagerInvalidPathLen
        );

        let mut amount_in = amount_in_;

        let base_position_manager = abi(
            BasePositionManager, 
            storage.base_position_manager.read().into()
        );

        if amount_in > 0 {
            let router = abi(Router, storage.router.read().into());

            let asset_id = path.get(0).unwrap();

            require(
                msg_asset_id() == asset_id,
                Error::PositionManagerInvalidAssetForwarded
            );

            require(
                msg_amount() == amount_in,
                Error::PositionManagerInvalidAssetAmount
            );

            if path.len() == 1 {
                router.plugin_transfer{
                    asset_id: asset_id.into(),
                    coins: amount_in
                }(
                    asset_id,
                    get_address_or_revert(),
                    Account::from(ContractId::this()),
                    amount_in
                );
            } else {
                router.plugin_transfer{
                    asset_id: asset_id.into(),
                    coins: amount_in
                }(
                    asset_id,
                    get_address_or_revert(),
                    Account::from(storage.vault.read()),
                    amount_in
                );

                amount_in = base_position_manager.swap(
                    path,
                    min_out,
                    Account::from(ContractId::this())
                );
            }

            let after_fee_amount = base_position_manager.collect_fees{
                asset_id: path.get(path.len() - 1).unwrap().into(),
                coins: amount_in
            }(
                get_address_or_revert(),
                path,
                amount_in,
                index_asset,
                is_long,
                size_delta
            );

            transfer_assets(
                path.get(path.len() - 1).unwrap(),
                Account::from(storage.vault.read()),
                after_fee_amount
            );
        }

        base_position_manager.increase_position(
            get_address_or_revert(),
            path.get(path.len() - 1).unwrap(),
            index_asset,
            size_delta,
            is_long,
            price
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
    require(get_sender() == storage.gov.read(), Error::PositionManagerForbidden);
}

#[storage(read)]
fn _only_order_keeper() {
    require(
        storage.is_order_keeper.get(get_address_or_revert())
            .try_read().unwrap_or(false),
        Error::PositionManagerOnlyOrderKeeper
    );
}

#[storage(read)]
fn _only_liquidator() {
    require(
        storage.is_liquidator.get(get_address_or_revert()).try_read().unwrap_or(false),
        Error::PositionManagerOnlyLiquidator
    );
}

#[storage(read)]
fn _only_partners_or_legacy_mode() {
    require(
        storage.is_partner.get(get_address_or_revert()).try_read().unwrap_or(false) ||
        storage.in_legacy_mode.read(),
        Error::PositionManagerOnlyPartnerOrLegacyMode
    );
}
