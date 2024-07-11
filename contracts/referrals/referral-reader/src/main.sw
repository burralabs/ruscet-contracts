// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____       __                     _   ____                _           
|  _ \ ___ / _| ___ _ __ _ __ __ _| | |  _ \ ___  __ _  __| | ___ _ __ 
| |_) / _ \ |_ / _ \ '__| '__/ _` | | | |_) / _ \/ _` |/ _` |/ _ \ '__|
|  _ <  __/  _|  __/ |  | | | (_| | | |  _ <  __/ (_| | (_| |  __/ |   
|_| \_\___|_|  \___|_|  |_|  \__,_|_| |_| \_\___|\__,_|\__,_|\___|_|   
*/

use std::{
    context::*,
    primitive_conversions::u64::*
};
use std::hash::*;
use referrals_interfaces::{
    referral_storage::ReferralStorage,
    referral_reader::ReferralReader,
};
use helpers::{
    context::*, 
    utils::*,
    transfer::*,
    asset::*
};

impl ReferralReader for Contract {
    fn get_codeowners(
        referral_storage_: ContractId,
        codes: Vec<b256>
    ) -> Vec<Account> {
        let mut codeowners: Vec<Account> = Vec::new();

        let referral_storage = abi(ReferralStorage, referral_storage_.into());

        let mut i = 0;
        while i < codes.len() {
            codeowners.push(referral_storage.get_codeowner(codes.get(i).unwrap()));
            i += 1;
        }

        codeowners
    }
    
}