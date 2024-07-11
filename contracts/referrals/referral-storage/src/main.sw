// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____       __                     _   ____  _                             
|  _ \ ___ / _| ___ _ __ _ __ __ _| | / ___|| |_ ___  _ __ __ _  __ _  ___ 
| |_) / _ \ |_ / _ \ '__| '__/ _` | | \___ \| __/ _ \| '__/ _` |/ _` |/ _ \
|  _ <  __/  _|  __/ |  | | | (_| | |  ___) | || (_) | | | (_| | (_| |  __/
|_| \_\___|_|  \___|_|  |_|  \__,_|_| |____/ \__\___/|_|  \__,_|\__, |\___|
                                                                |___/
*/

mod constants;
mod structs;
mod events;
mod errors;

use std::{
    context::*,
    revert::require,
    primitive_conversions::u64::*
};
use std::hash::*;
use referrals_interfaces::referral_storage::ReferralStorage;
use helpers::{
    context::*, 
    utils::*,
    transfer::*,
    asset::*
};
use constants::*;
use structs::*;
use events::*;
use errors::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    
    referrer_discount_shares: StorageMap<Account, u64> = StorageMap::<Account, u64> {},
    referrer_tiers: StorageMap<Account, u64> = StorageMap::<Account, u64> {},
    tiers: StorageMap<u64, Tier> = StorageMap::<u64, Tier> {},

    is_handler: StorageMap<Account, bool> = StorageMap::<Account, bool> {},

    code_owners: StorageMap<b256, Account> = StorageMap::<b256, Account> {},
    trader_referral_codes: StorageMap<Account, b256> = StorageMap::<Account, b256> {},
}

impl ReferralStorage for Contract {
    #[storage(read, write)]
    fn initialize() {
        require(
            !storage.is_initialized.read(), 
            Error::ReferralStorageAlreadyInitialized
        );
        storage.is_initialized.write(true);

        storage.gov.write(get_sender());
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_handler(handler: Account, is_active: bool) {
        _only_gov();
        storage.is_handler.insert(handler, is_active);

        log(SetHandler {
            handler, is_active
        });
    }

    #[storage(read, write)]
    fn set_tier(
        tier_id: u64, 
        total_rebate: u64,
        discount_share: u64,
    ) {
        _only_gov();

        require(
            total_rebate <= BASIS_POINTS,
            Error::ReferralStorageInvalidTotalRebate
        );
        require(
            discount_share <= BASIS_POINTS,
            Error::ReferralStorageInvalidDiscountShare
        );

        storage.tiers.insert(
            tier_id,
            Tier {
                total_rebate,
                discount_share
            }
        );

        log(SetTier {
            tier_id, total_rebate, discount_share
        });
    }

    #[storage(read, write)]
    fn set_referrer_tier(
        referrer: Account,
        tier_id: u64, 
    ) {
        _only_gov();

        storage.referrer_tiers.insert(
            referrer,
            tier_id
        );

        log(SetReferrerTier {
            referrer, tier_id
        });
    }

    #[storage(read, write)]
    fn set_trader_referral_code(
        account: Account,
        code: b256
    ) {
        _only_handler();

        _set_trader_referral_code(account, code);
    }

    #[storage(read, write)]
    fn gov_set_codeowner(code: b256, new_account: Account) {
        _only_gov();

        require(code != ZERO, Error::ReferralStorageInvalidCode);

        storage.code_owners.insert(code, new_account);
        
        log(GovSetCodeOwner {
            new_account,
            code
        });
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_trader_referral_code(account: Account) -> b256 {
        storage.trader_referral_codes.get(account).try_read().unwrap_or(ZERO)
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn set_referrer_discount_share(discount_share: u64) {
        require(
            discount_share <= BASIS_POINTS,
            Error::ReferralStorageInvalidDiscountShare
        );

        storage.referrer_discount_shares.insert(
            get_sender(),
            discount_share
        );

        log(SetReferrerDiscountShare {
            referrer: get_sender(), discount_share
        });
    }

    #[storage(read, write)]
    fn set_trader_referral_code_by_user(code: b256) {
        _set_trader_referral_code(get_sender(), code);
    }

    #[storage(read, write)]
    fn register_code(code: b256) {
        require(code != ZERO, Error::ReferralStorageInvalidCode);
        require(
            storage.code_owners.get(code).try_read().unwrap_or(ZERO_ACCOUNT) == ZERO_ACCOUNT,
            Error::ReferralStorageCodeAlreadyExists
        );

        storage.code_owners.insert(code, get_sender());
        log(RegisterCode {
            account: get_sender(),
            code
        });
    }

    #[storage(read, write)]
    fn set_codeowner(code: b256, new_account: Account) {
        require(code != ZERO, Error::ReferralStorageInvalidCode);

        let account = storage.code_owners.get(code).try_read().unwrap_or(ZERO_ACCOUNT);
        require(
            account == get_sender(),
            Error::ReferralStorageForbiddenNotCodeOwner
        );

        storage.code_owners.insert(code, new_account);
        
        log(SetCodeOwner {
            account: get_sender(),
            new_account,
            code
        });
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_trader_referral_info(account: Account) -> (b256, Account) {
        let code = storage.trader_referral_codes.get(account).try_read().unwrap_or(ZERO);
        let mut referrer = ZERO_ACCOUNT;

        if code != ZERO {
            referrer = storage.code_owners.get(code).try_read().unwrap_or(ZERO_ACCOUNT);
        }

        (code, referrer)
    }

    #[storage(read)]
    fn get_codeowner(code: b256) -> Account {
        storage.code_owners.get(code).try_read().unwrap_or(ZERO_ACCOUNT)
    }
}

/*
    ____  ___       _                        _ 
   / / / |_ _|_ __ | |_ ___ _ __ _ __   __ _| |
  / / /   | || '_ \| __/ _ \ '__| '_ \ / _` | |
 / / /    | || | | | ||  __/ |  | | | | (_| | |
/_/_/    |___|_| |_|\__\___|_|  |_| |_|\__,_|_|
*/

#[storage(read)]
fn _only_gov() {
    require(get_sender() == storage.gov.read(), Error::ReferralStorageForbiddenNotGov);
}

#[storage(read)]
fn _only_handler() {
    require(
        storage.is_handler.get(get_sender()).try_read().unwrap_or(false),
        Error::ReferralStorageForbiddenOnlyHandler
    );
}

#[storage(read, write)]
fn _set_trader_referral_code(account: Account, code: b256) {
    storage.trader_referral_codes.insert(account, code);

    log(SetTraderReferralCode {
        account, code
    });
}
