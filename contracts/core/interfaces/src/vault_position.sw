// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
};

abi VaultPosition {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault_router: ContractId,
        vault_storage: ContractId,
        vault_utils: ContractId,
        vault: ContractId
    );

    /*
          ____     _       _           _
         / / /    / \   __| |_ __ ___ (_)_ __
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_gov(gov: Account);

    #[storage(read, write)]
    fn set_vault_router(vault_router: ContractId);

    #[storage(read, write)] 
    fn set_vault_storage(vault_storage: ContractId);

    #[storage(read, write)]
    fn set_vault_utils(vault_utils: ContractId);

    #[storage(read, write)]
    fn set_vault(vault: ContractId);


    /*
          ____ __     ___
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V /
      /_/_/       \_/  |_|\___| \_/\_/
    */
    #[storage(read)]
    fn get_gov() -> Account;

    #[storage(read)]
    fn get_vault_router() -> ContractId;

    #[storage(read)]
    fn get_vault_storage() -> ContractId;

    #[storage(read)]
    fn get_vault_utils() -> ContractId;

    #[storage(read)]
    fn get_vault() -> ContractId;

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
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        size_delta: u256,
        is_long: bool,
        tx_sender: Account
    );

    #[storage(read)]
    fn decrease_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account,
        tx_sender: Account
    ) -> u256;

    #[storage(read)]
    fn liquidate_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        is_long: bool,
        fee_receiver: Account,
        tx_sender: Account
    );
}