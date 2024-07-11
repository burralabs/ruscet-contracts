// SPDX-License-Identifier: Apache-2.0
library;

use std::{
    hash::{
        Hash,
        sha256,
    },
    revert::require,
    storage::storage_string::*,
    string::String,
};
use helpers::{
    context::Account
};

/*
    The same as `FungibleFactory` except the `sub_id` is fixed at `ZERO` (only one asset for this contract)
*/

abi FungibleAsset {
    #[storage(read, write)]
    fn initialize(
        name: String,
        symbol: String,
        decimals: u8
    );

    /*
           ____  ____  ____   ____ ____   ___  
          / / / / ___||  _ \ / ___|___ \ / _ \ 
         / / /  \___ \| |_) | |     __) | | | |
        / / /    ___) |  _ <| |___ / __/| |_| |
       /_/_/    |____/|_| \_\\____|_____|\___/                                         
       from: https://github.com/FuelLabs/sway-standards/tree/master/standards/src20-native-asset  
    */
    #[storage(read)]
    fn name() -> String;

    #[storage(read)]
    fn symbol() -> String;
    
    #[storage(read)]
    fn decimals() -> u8;

    #[storage(read)]
    fn total_supply() -> u64;

    /*
           ____  ____  ____   ____ _____ 
          / / / / ___||  _ \ / ___|___ / 
         / / /  \___ \| |_) | |     |_ \ 
        / / /    ___) |  _ <| |___ ___) |
       /_/_/    |____/|_| \_\\____|____/   
       from: https://github.com/FuelLabs/sway-standards/blob/master/standards/src3-mint-burn 
    */
    /// Mints new assets using the `sub_id` sub-identifier.
    ///
    /// # Arguments
    ///
    /// * `recipient`: [Account] - The user to which the newly minted asset is transferred to.
    /// * `sub_id`: [SubId] - The sub-identifier of the newly minted asset.
    /// * `amount`: [u64] - The quantity of coins to mint.
    ///
    /// # Examples
    ///
    /// ```sway
    /// use src3::SRC3;
    ///
    /// fn foo(contract_id: ContractId) {
    ///     let contract_abi = abi(SR3, contract);
    ///     contract_abi.mint(Account::ContractId(contract_id), ZERO_B256, 100);
    /// }
    /// ```
    #[storage(read, write)]
    fn mint(recipient: Account, amount: u64);

    /// Burns assets sent with the given `sub_id`.
    ///
    /// # Additional Information
    ///
    /// NOTE: The sha-256 hash of `(ContractId, SubId)` must match the `AssetId` where `ContractId` is the id of
    /// the implementing contract and `SubId` is the given `sub_id` argument.
    ///
    /// # Arguments
    ///
    /// * `sub_id`: [SubId] - The sub-identifier of the asset to burn.
    /// * `amount`: [u64] - The quantity of coins to burn.
    ///
    /// # Examples
    ///
    /// ```sway
    /// use src3::SRC3;
    ///
    /// fn foo(contract_id: ContractId, asset_id: AssetId) {
    ///     let contract_abi = abi(SR3, contract_id);
    ///     contract_abi {
    ///         gas: 10000,
    ///         coins: 100,
    ///         asset_id: asset_id,
    ///     }.burn(ZERO_B256, 100);
    /// }
    /// ```
    #[payable]
    #[storage(read, write)]
    fn burn(amount: u64);

    /*
           ____  ____        _                      
          / / / | __ )  __ _| | __ _ _ __   ___ ___ 
         / / /  |  _ \ / _` | |/ _` | '_ \ / __/ _ \
        / / /   | |_) | (_| | | (_| | | | | (_|  __/
       /_/_/    |____/ \__,_|_|\__,_|_| |_|\___\___|
    */
    /// Get the balance of sub-identifier `sub_id` for the current contract.
    ///
    /// # Additional Information
    ///
    /// This method is a convenience method only used to query the balance of the contract's native assets,
    /// owned by the current contract (`contract_id()`)
    ///
    /// This method is not used to query the balance of an EOA on Fuel because EOAs follow the UTXO model, 
    /// while contracts follow the account model (i.e. EOAs don't "have" balances)
    ///
    /// # Arguments
    ///
    /// * `sub_id`: [SubId] - The sub-identifier of the balance to be queried
    ///
    /// # Returns
    ///
    /// * [u64] - The amount of the asset which the contract holds.
    ///
    /// # Examples
    ///
    /// ```sway
    /// use std::{context::this_balance, constants::ZERO_B256, hash::sha256, asset::mint, call_frames::contract_id};
    ///
    /// fn foo() {
    ///     mint(ZERO_B256, 50);
    ///     assert(this_balance(sha256((ZERO_B256, contract_id()))) == 50);
    /// }
    /// ```
    fn this_balance() -> u64;

    /// Get the balance of sub-identifier `sub_id` for the contract at 'target'.
    ///
    /// # Additional Information
    ///
    /// This method is a convenience method only used to query the balance of the contract's native assets,
    /// owned by a particular CONTRACT (identifiable by `target`).
    ///
    /// This method is not used to query the balance of an EOA on Fuel because EOAs follow the UTXO model, 
    /// while contracts follow the account model (i.e. EOAs don't "have" balances)
    ///
    /// # Arguments
    ///
    /// * `target`: [ContractId] - The contract that contains the `asset_id`.
    /// * `asset_id`: [AssetId] - The asset of which the balance should be returned.
    ///
    /// # Returns
    ///
    /// * [u64] - The amount of the asset which the `target` holds.
    ///
    /// # Examples
    ///
    /// ```sway
    /// use std::{context::balance_of, constants::ZERO_B256, hash::sha256, asset::mint, call_frames::contract_id};
    ///
    /// fn foo() {
    ///     mint(ZERO_B256, 50);
    ///     assert(balance_of(contract_id(), sha256((ZERO_B256, contract_id()))) == 50);
    /// }
    /// ```
    fn get_balance(target: ContractId) -> u64;

    /*
           ____  _____                     __           
          / / / |_   _| __ __ _ _ __  ___ / _| ___ _ __ 
         / / /    | || '__/ _` | '_ \/ __| |_ / _ \ '__|
        / / /     | || | | (_| | | | \__ \  _|  __/ |   
       /_/_/      |_||_|  \__,_|_| |_|___/_|  \___|_|
    */
    /// Transfer `amount` coins of the sub-identifier `sub_id` and send them
    /// to `to` by calling either `force_transfer_to_contract` or
    /// `transfer_to_address`, depending on the type of `Account`.
    ///
    /// # Additional Information
    ///
    /// This method is a convenience method only used to transfer native assets belonging to the contract, 
    /// and identifiable by the `sub_id` sub-identifier.
    ///
    /// If the `to` Account is a contract this may transfer coins to the contract even with no way to retrieve them
    /// (i.e. no withdrawal functionality on receiving contract), possibly leading
    /// to the **_PERMANENT LOSS OF COINS_** if not used with care.
    ///
    /// # Arguments
    ///
    /// * `to`: [Account] - The recipient identity.
    /// * `asset_id`: [AssetId] - The asset to transfer.
    /// * `amount`: [u64] - The amount of coins to transfer.
    ///
    /// # Reverts
    ///
    /// * When `amount` is greater than the contract balance for `asset_id`.
    /// * When `amount` is equal to zero.
    /// * When there are no free variable outputs when transferring to an `Address`.
    ///
    /// # Examples
    ///
    /// ```sway
    /// use std::{constants::{BASE_ASSET_ID, ZERO_B256}, asset::transfer};
    ///
    /// fn foo() {
    ///     let to_address = Account::Address(Address::from(ZERO_B256));
    ///     let to_contract_id = Account::ContractId(ContractId::from(ZERO_B256));
    ///     transfer(to_address, BASE_ASSET_ID, 500);
    ///     transfer(to_contract_id, BASE_ASSET_ID, 500);
    /// }
    /// ```
    #[payable]
    fn transfer(to: Account, amount: u64);
    
    #[payable]
    fn transfer_to_address(
        to: Address,
        amount: u64
    );
    #[payable]
    fn transfer_to_contract(
        to: ContractId,
        amount: u64
    );

    /*
           ____  __  __ _          
          / / / |  \/  (_)___  ___ 
         / / /  | |\/| | / __|/ __|
        / / /   | |  | | \__ \ (__ 
       /_/_/    |_|  |_|_|___/\___|
    */
    fn get_asset_id() -> AssetId;
}
