// SPDX-License-Identifier: Apache-2.0
library;

use helpers::context::Account;

pub struct SetGov {
    pub gov: Account,
}

pub struct SetAdmin {
    pub account: Account,
    pub active: bool,
}

pub struct SetVault {
    pub vault: ContractId,
    pub active: bool,
}

pub struct SetStakedBalanceHandler {
    pub staked_balance_handler: Address,
}

pub struct SetYieldTrackers {
    pub yield_trackers: Vec<ContractId>,
}

pub struct SetNonStakingAccount {
    pub account: Account,
    pub active: bool,
}
