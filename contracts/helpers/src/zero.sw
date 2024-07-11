// SPDX-License-Identifier: Apache-2.0
library;

use ::context::Account;
use ::utils::{
    ZERO,
    ZERO_ADDRESS,
    ZERO_CONTRACT,
    ZERO_ACCOUNT
};

impl Address {
    pub fn non_zero(self) -> bool {
        self != ZERO_ADDRESS
    }
}

impl ContractId {
    pub fn non_zero(self) -> bool {
        self != ZERO_CONTRACT
    }
}

impl Account {
    pub fn non_zero(self) -> bool {
        self != ZERO_ACCOUNT
    }
}

impl AssetId {
    pub fn non_zero(self) -> bool {
        // self != AssetId::from(ZERO)
        true
    }
}