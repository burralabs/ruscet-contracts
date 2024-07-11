// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    asset::*,
};

abi ReferralStorage {
    #[storage(read, write)]
    fn initialize();

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_handler(handler: Account, is_active: bool);

    #[storage(read, write)]
    fn set_tier(
        tier_id: u64, 
        total_rebate: u64,
        discount_share: u64,
    );

    #[storage(read, write)]
    fn set_referrer_tier(
        referrer: Account,
        tier_id: u64, 
    );

    #[storage(read, write)]
    fn set_trader_referral_code(
        account: Account,
        code: b256
    );

    #[storage(read, write)]
    fn gov_set_codeowner(code: b256, new_account: Account);

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_trader_referral_code(account: Account) -> b256;

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn set_referrer_discount_share(discount_share: u64);

    #[storage(read, write)]
    fn set_trader_referral_code_by_user(code: b256);

    #[storage(read, write)]
    fn register_code(code: b256);

    #[storage(read, write)]
    fn set_codeowner(code: b256, new_account: Account);

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_trader_referral_info(account: Account) -> (b256, Account);

    #[storage(read)]
    fn get_codeowner(code: b256) -> Account;
} 