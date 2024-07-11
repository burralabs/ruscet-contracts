// SPDX-License-Identifier: Apache-2.0
library;

use helpers::{
    context::*,
    asset::*,
};

abi BalanceUpdater {
    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[payable]
    fn update_balance(
        vault_: ContractId,
        asset: AssetId,
        rusd: WrappedAsset,
        rusd_amount: u64
    );
} 