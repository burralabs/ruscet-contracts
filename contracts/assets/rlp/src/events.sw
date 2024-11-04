// SPDX-License-Identifier: Apache-2.0
library;

use helpers::context::Account;

pub struct SetGov {
    pub gov: Account,
}

pub struct SetApprovedMinter {
    pub minter: Account,
    pub is_active: bool,
}