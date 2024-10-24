// SPDX-License-Identifier: Apache-2.0
library;

use helpers::context::Account;

pub struct SetGov {
    pub gov: Account,
}

pub struct SetVaultStorage {
    pub vault_storage: ContractId,
}

pub struct SetVaultUtils {
    pub vault_utils: ContractId,
}

pub struct SetVault {
    pub vault: ContractId,
}

pub struct SetVaultRusd {
    pub vault_rusd: ContractId,
}

pub struct SetVaultPosition {
    pub vault_position: ContractId,
}

