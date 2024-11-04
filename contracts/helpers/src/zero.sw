// SPDX-License-Identifier: Apache-2.0
library;

use ::context::Account;

pub const ZERO = 0x0000000000000000000000000000000000000000000000000000000000000000;
pub const ZERO_ADDRESS = Address::from(ZERO);
pub const ZERO_CONTRACT = ContractId::from(ZERO);
pub const ZERO_ASSET = AssetId::from(ZERO);
pub const ZERO_ACCOUNT = Account::from(ZERO_ADDRESS);

impl Account {
    pub fn is_zero(self) -> bool {
        self == ZERO_ACCOUNT
    }
}
