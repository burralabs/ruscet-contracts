// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
};

abi VaultRusd {
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
    #[storage(read)]
    fn withdraw_fees(
        asset: AssetId,
        receiver: Account,
        tx_sender: Account
    );

    #[payable]
    #[storage(read)]
    fn direct_pool_deposit(asset: AssetId);

    #[payable]
    #[storage(read)]
    fn buy_rusd(
        asset: AssetId,
        receiver: Account
    ) -> u256;

    #[payable]
    #[storage(read)]
    fn sell_rusd(
        asset: AssetId,
        receiver: Account
    ) -> u256;

    #[payable]
    #[storage(read)]
    fn swap(
        asset_in: AssetId,
        asset_out: AssetId,
        receiver: Account
    ) -> u64;
}