// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____  _     ____           __   ___      _     _      _                 _   
|  _ \| |   |  _ \          \ \ / (_) ___| | __| |    / \   ___ ___  ___| |_ 
| |_) | |   | |_) |  _____   \ V /| |/ _ \ |/ _` |   / _ \ / __/ __|/ _ \ __|
|  _ <| |___|  __/  |_____|   | | | |  __/ | (_| |  / ___ \\__ \__ \  __/ |_ 
|_| \_\_____|_|               |_| |_|\___|_|\__,_| /_/   \_\___/___/\___|\__|
*/

mod errors;

use std::{
    asset::{mint_to, burn as asset_burn, transfer},
    context::*,
    revert::require,
    storage::{
        storage_string::*,
        storage_vec::*,
    },
    call_frames::msg_asset_id,
    string::String
};
use std::hash::*;
use helpers::{
    context::*, 
    utils::*, 
    transfer::*
};
use asset_interfaces::rlp::RLP;
use errors::*;

storage {
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    
    name: StorageString = StorageString {},
    symbol: StorageString = StorageString {},
    decimals: u8 = 8,

    balances: StorageMap<Account, u64> = StorageMap::<Account, u64> {},
    allowances: StorageMap<Account, StorageMap<Account, u64>> 
        = StorageMap::<Account, StorageMap<Account, u64>> {},
    total_supply: u64 = 0,

    minters: StorageMap<Account, bool> = StorageMap::<Account, bool> {},
}

impl RLP for Contract {
    #[storage(read, write)]
    fn initialize() {
        require(
            !storage.is_initialized.read(), 
            Error::RLPAlreadyInitialized
        );

        storage.is_initialized.write(true);

        storage.name.write_slice(String::from_ascii_str("RLP"));
        storage.symbol.write_slice(String::from_ascii_str("RLP"));
        
        storage.gov.write(get_sender());
        storage.minters.insert(get_sender(), true);
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

    #[storage(read, write)]
    fn set_minter(minter: Account, is_active: bool) {
        _only_gov();

        storage.minters.insert(minter, is_active);
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    fn get_id() -> AssetId {
        AssetId::new(ContractId::this(), ZERO)
    }

    #[storage(read)]
    fn id() -> String {
        storage.symbol.read_slice().unwrap()
    }

    #[storage(read)]
    fn name() -> String {
        storage.name.read_slice().unwrap()
    }

    #[storage(read)]
    fn symbol() -> String {
        storage.symbol.read_slice().unwrap()
    }

    #[storage(read)]
    fn decimals() -> u8 {
        storage.decimals.read()
    }

    #[storage(read)]
    fn total_supply() -> u64 {
        storage.total_supply.read()
    }

    #[storage(read)]
    fn balance_of(who: Account) -> u64 {
        storage.balances.get(who).try_read().unwrap_or(0)
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn approve(spender: Account, amount: u64) -> bool {
        _approve(get_sender(), spender, amount);
        true
    }

    #[payable]
    #[storage(read, write)]
    fn transfer(
        to: Account,
        amount: u64
    ) -> bool {
        _transfer(get_sender(), to, amount);
        true
    }

    #[storage(read, write)]
    fn transfer_on_behalf_of(
        who: Account,
        to: Account,
        amount: u64,
    ) -> bool {
        let sender_allowance = storage.allowances.get(who).get(get_sender()).try_read().unwrap_or(0);
        require(sender_allowance >= amount, Error::RLPInsufficientAllowance);

        _approve(who, get_sender(), sender_allowance - amount);
        _transfer(who, to, amount);

        true
    }

    #[storage(read, write)]
    fn mint(account: Account, amount: u64) {
        _only_minter();
        _mint(account, amount)
    }

    #[payable]
    #[storage(read, write)]
    fn burn(account: Account, amount: u64) {
        _only_minter();
        _burn(account, amount)
    }
}

#[storage(read)]
fn _only_gov() {
    require(
        get_sender() == storage.gov.read(),
        Error::RLPForbidden
    );
}

#[storage(read)]
fn _only_minter() {
    require(
        storage.minters.get(get_sender()).try_read().unwrap_or(false),
        Error::RLPOnlyMinter
    );
}

#[storage(read, write)]
fn _mint(
    account: Account,
    amount: u64
) {
    require(account != ZERO_ACCOUNT, Error::RLPMintToZeroAccount);

    let identity = account_to_identity(account);

    storage.total_supply.write(storage.total_supply.read() + amount);
    storage.balances.get(account).write(
        storage.balances.get(account).try_read().unwrap_or(0) + amount
    );

    // sub-id: ZERO_B256
    mint_to(identity, ZERO, amount);
}

#[storage(read, write)]
fn _burn(
    account: Account,
    amount: u64
) {
    // @TODO: verify if the assets to be burned need to be forwarded to this call
    // @TODO: verify the same for `RSCT`
    require(account != ZERO_ACCOUNT, Error::RLPBurnFromZeroAccount);
    require(
        msg_asset_id() == AssetId::new(ContractId::this(), ZERO),
        Error::RLPInvalidBurnAssetForwarded
    );
    require(
        msg_amount() == amount,
        Error::RLPInvalidBurnAmountForwarded
    );

    let account_balance = storage.balances.get(account).try_read().unwrap_or(0);
    require(account_balance >= amount, Error::RLPBurnAmountExceedsBalance);

    storage.balances.get(account).write(account_balance - amount);
    storage.total_supply.write(storage.total_supply.read() - amount);

    // sub-id: ZERO_B256
    asset_burn(ZERO, amount);
}

#[payable]
#[storage(read, write)]
fn _transfer(
    sender: Account,
    recipient: Account,
    amount: u64
) {
    require(sender != ZERO_ACCOUNT, Error::RLPTransferFromZeroAccount);
    require(recipient != ZERO_ACCOUNT, Error::RLPTransferToZeroAccount);

    require(
        amount == msg_amount(),
        Error::RLPInsufficientTransferAmountForwarded
    );

    let sender_balance = storage.balances.get(sender).try_read().unwrap_or(0);
    require(sender_balance >= amount, Error::RLPInsufficientBalance);

    storage.balances.get(sender).write(sender_balance - amount);
    storage.balances.get(recipient).write(
        storage.balances.get(recipient).try_read().unwrap_or(0) + amount
    );

    transfer_assets(
        msg_asset_id(),
        recipient,
        amount
    );
}

#[storage(read, write)]
fn _approve(
    owner: Account,
    spender: Account, 
    amount: u64
) {
    require(owner != ZERO_ACCOUNT, Error::RLPApproveFromZeroAccount);
    require(spender != ZERO_ACCOUNT, Error::RLPApproveToZeroAccount);

    storage.allowances.get(get_sender()).insert(spender, amount);
}