// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    asset::*,
};

abi ReferralReader {
    fn get_codeowners(
        referral_storage: ContractId,
        codes: Vec<b256>
    ) -> Vec<Account>;
} 