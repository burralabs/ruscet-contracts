// SPDX-License-Identifier: Apache-2.0
library;

use std::auth::msg_sender;
use ::context::*;

/*
  ____                _              _       
 / ___|___  _ __  ___| |_ __ _ _ __ | |_ ___ 
| |   / _ \| '_ \/ __| __/ _` | '_ \| __/ __|
| |__| (_) | | | \__ \ || (_| | | | | |_\__ \
 \____\___/|_| |_|___/\__\__,_|_| |_|\__|___/
*/
pub const ZERO = 0x0000000000000000000000000000000000000000000000000000000000000000;
pub const ZERO_ADDRESS = Address::from(ZERO);
pub const ZERO_CONTRACT = ContractId::from(ZERO);
pub const ZERO_ASSET = AssetId::from(ZERO);
pub const ZERO_ACCOUNT = Account::from(ZERO_ADDRESS);

// enum Error {
//     ExpectedCallerToBeEOA: (),
//     ExpectedCallerToBeContract: (),
// }

pub fn get_sender() -> Account {
    match msg_sender().unwrap() {
        Identity::Address(addr) => Account::from(addr),
        Identity::ContractId(contr) => Account::from(contr),
    }
}

pub fn get_address_or_revert() -> Address {
    get_sender_non_contract()
}


pub fn get_contract_or_revert() -> ContractId {
    get_sender_contract()
}

// Force require the msg.sender to be from an EOA (not an external contract)
pub fn get_sender_non_contract() -> Address {
    let addr = match msg_sender().unwrap() {
        Identity::Address(addr) => addr,
        _ => revert(0), // ZERO_ADDRESS
    };

    // custom errors here fault-out with some strange behaviour
    // @TODO: this is to be investigated
    // require(
    //     ret == ZERO_CONTRACT, __to_str_array("Error::ExpectedCallerToBeContract")
    // );

    return addr;
}

// Force require the msg.sender to be from an external contract
pub fn get_sender_contract() -> ContractId {
    let contr = match msg_sender().unwrap() {
        Identity::ContractId(_contr) => _contr,
        _ => revert(0), // ZERO_CONTRACT
    };

    // custom errors here fault-out with some strange behaviour
    // @TODO: this is to be investigated
    // require(
    //     ret == ZERO_CONTRACT, __to_str_array("Error::ExpectedCallerToBeContract")
    // );

    return contr;
}

pub fn check_nonzero(account: Account) -> bool {
    account.value != ZERO
}

pub fn account_to_identity(account: Account) -> Identity {
    if account.is_contract {
        Identity::ContractId(ContractId::from(account.value))
    } else {
        Identity::Address(Address::from(account.value))
    }
}