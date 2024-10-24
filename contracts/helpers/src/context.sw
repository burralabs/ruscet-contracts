// SPDX-License-Identifier: Apache-2.0
library;

/*
    `Account` is a unified type and abstraction over the `Identity` of an account on Fuel.
*/
use std::{
    auth::msg_sender,
    identity::Identity,
    convert::{From}
};
use std::hash::{Hash, Hasher};

pub struct Account {
    /// The underlying raw `b256` data of the sender context.
    pub value: b256,
    /// By default, we assume that the sender is an EOA (not an external contract)
    pub is_contract: bool
}

impl core::ops::Eq for Account {
    fn eq(self, other: Self) -> bool {
        self.value == other.value && self.is_contract == other.is_contract
    }
}

impl From<Address> for Account {
    fn from(address: Address) -> Self {
        Self { value: address.into(), is_contract: false }
    }

    // fn into(self) -> Address {
    //     require(!self.is_contract, "[Account] failed to convert from type `ContractId` to `Address` ");
    //     Address::from(0x0000000000000000000000000000000000000000000000000000000000000000)
    // }
}


impl From<ContractId> for Account {
    fn from(address: ContractId) -> Self {
        Self { value: address.into(), is_contract: true }
    }

    // fn into(self) -> ContractId {
    //     require(self.is_contract, "[Account] failed to convert from type `Address` to `ContractId` ");
    //     ContractId::from(0x0000000000000000000000000000000000000000000000000000000000000000)
    // }
}

/*
impl From<Identity> for Identity {
    fn from(identity: Identity) -> Self {
        match identity {
            Identity::Address(addr) => Self { value: addr.value, is_contract: false },
            Identity::ContractId(contr) => Self { value: contr.value, is_contract: true },
        }
    }

    fn into(self) -> Identity {
        require(false, "[fail] do not use `into` to convert to `ContractId`");
        Identity::Address { value: 0x0000000000000000000000000000000000000000000000000000000000000000 }
    }
}
*/

impl Hash for Account {
    fn hash(self, ref mut state: Hasher) {
        self.value.hash(state);
        self.is_contract.hash(state);
    }
}