// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____           _ _   _               ____             _            
|  _ \ ___  ___(_) |_(_) ___  _ __   |  _ \ ___  _   _| |_ ___ _ __ 
| |_) / _ \/ __| | __| |/ _ \| '_ \  | |_) / _ \| | | | __/ _ \ '__|
|  __/ (_) \__ \ | |_| | (_) | | | | |  _ < (_) | |_| | ||  __/ |   
|_|   \___/|___/_|\__|_|\___/|_| |_| |_| \_\___/ \__,_|\__\___|_|   
*/

mod events;
mod errors;

use std::{
    block::{timestamp, height},
    call_frames::*,
    context::*,
    revert::require,
    storage::storage_vec::*,
    primitive_conversions::u64::*
};
use std::hash::*;
use core_interfaces::{
    base_position_manager::BasePositionManager,
    position_router::*,
};
use referrals_interfaces::referral_storage::ReferralStorage;
use helpers::{
    context::*,
    utils::*,
    signed_64::*,
    transfer::transfer_assets,
    fixed_vec::FixedVecAssetIdSize5
};
use events::*;
use errors::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    is_leverage_enabled: bool = true,
    
    vault: ContractId = ZERO_CONTRACT,
    base_position_manager: ContractId = ZERO_CONTRACT,

    // used only to determine _transfer_in values
    asset_balances: StorageMap<AssetId, u64> = StorageMap::<AssetId, u64> {},
}

impl PositionRouter for Contract {
    #[storage(read, write)]
    fn initialize(
        base_position_manager: ContractId,
        vault: ContractId
    ) {
        require(!storage.is_initialized.read(), Error::PositionRouterAlreadyInitialized);
        storage.is_initialized.write(true);

        storage.gov.write(get_sender());
        storage.base_position_manager.write(base_position_manager);
        storage.vault.write(vault);
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_gov(new_gov: Account) {
        _only_gov();
        storage.gov.write(new_gov);
    }

    #[storage(read, write)]
    fn set_is_leverage_enabled(is_leverage_enabled: bool) {
        _only_gov();
        storage.is_leverage_enabled.write(is_leverage_enabled);
        log(SetIsLeverageEnabled { is_leverage_enabled });
    }

    /*
          ____ __     ___               
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_base_position_manager() -> ContractId {
        storage.base_position_manager.read()
    }

    #[storage(read)]
    fn get_asset_balances(asset_id: AssetId) -> u64 {
        storage.asset_balances.get(asset_id).try_read().unwrap_or(0)
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[storage(read, write)]
    fn increase_position(
        path: Vec<AssetId>,
        index_asset: AssetId,
        amount_in: u64,
        min_out: u64,
        size_delta: u256,
        is_long: bool,
        acceptable_price: u256,
        referral_code: b256,
    ) -> bool {
        require(
            path.len() == 1 || path.len() == 2,
            Error::PositionRouterInvalidPathLen
        );

        _set_trader_referral_code(referral_code);

        if amount_in > 0 {
            // collateral asset is first value in `path`
            let collateral_asset = path.get(0).unwrap();
            let amount = _transfer_in(collateral_asset);
            require(
                amount == amount_in,
                Error::PositionRouterIncorrectCollateralAmountForwarded
            );
        }

        let (is_executed, _) = _execute_increase_position(
            path,
            index_asset,
            amount_in,
            min_out,
            size_delta,
            is_long,
            acceptable_price,
            false
        );

        is_executed
    }

    #[storage(read, write)]
    fn decrease_position(
        path: Vec<AssetId>,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account,
        acceptable_price: u256,
        min_out: u64,
    ) -> bool {
        require(
            path.len() == 1 || path.len() == 2,
            Error::PositionRouterInvalidPathLen
        );

        let (is_executed, _) = _execute_decrease_position(
            path,
            index_asset,
            collateral_delta,
            size_delta,
            is_long,
            receiver,
            acceptable_price,
            min_out,
            false
        );

        is_executed
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
    require(get_sender() == storage.gov.read(), Error::PositionRouterForbidden);
}

#[storage(read, write)]
fn _transfer_in(asset_id: AssetId) -> u64 {
    let prev_balance = storage.asset_balances.get(asset_id).try_read().unwrap_or(0);
    let next_balance = balance_of(ContractId::this(), asset_id);
    storage.asset_balances.insert(asset_id, next_balance);

    require(
        next_balance >= prev_balance,
        Error::PositionRouterZeroCollateralAmountForwarded
    );

    next_balance - prev_balance
}

#[storage(read, write)]
fn _transfer_out(
    asset_id: AssetId, 
    amount: u64, 
    receiver: Account,
) {
    transfer_assets(
        asset_id,
        receiver,
        amount
    );

    storage.asset_balances.insert(asset_id, balance_of(ContractId::this(), asset_id));
}

#[storage(read)]
fn _validate_execution(
    account: Account,
    disable_eager_revert: bool
) -> (bool, bool) {
    let sender = get_sender();

    if sender != account {
        if disable_eager_revert {
            return (false, true);
        }
        require(false, Error::PositionRouterExpectedAccountToBeSender);
    }

    if !storage.is_leverage_enabled.read() {
        if disable_eager_revert {
            return (false, true);
        }
        require(false, Error::PositionRouterLeverageNotEnabled);
    }

    (true, false)
}

#[storage(read, write)]
fn _execute_increase_position(
    path: Vec<AssetId>,
    index_asset: AssetId,
    _amount_in: u64,
    min_out: u64,
    size_delta: u256,
    is_long: bool,
    acceptable_price: u256,
    disable_eager_revert: bool
) -> (bool, bool) {
    let account = get_sender();

    let (should_execute, is_execution_error) = _validate_execution(
        account,
        disable_eager_revert
    );
    if is_execution_error {
        return (false, true);
    }
    if !should_execute {
        return (false, false);
    }

    let base_position_manager = abi(
        BasePositionManager,
        storage.base_position_manager.read().into()
    );
    
    let mut amount_in = _amount_in;

    let collateral_asset = path.get(path.len() - 1).unwrap();

    if _amount_in > 0 {
        if path.len() > 1 {
            _transfer_out(
                path.get(0).unwrap(),
                amount_in,
                Account::from(storage.vault.read())
            );
            amount_in = base_position_manager.swap(
                path,
                min_out,
                Account::from(ContractId::this())
            );
        }

        // fee asset is the last asset in the path
        // thesis: we send the "ENTIRE" amount of `amount_in` to BasePositionManager
        // BPM will process and return any excess amount back to us
        let fee_asset = collateral_asset;

        let after_fee_amount = base_position_manager.collect_fees{
            asset_id: fee_asset.into(),
            coins: amount_in
        }(
            account,
            path,
            amount_in,
            index_asset,
            is_long,
            size_delta
        );

        _transfer_out(
            fee_asset,
            after_fee_amount,
            Account::from(storage.vault.read())
        );
    }

    base_position_manager.increase_position(
        account,
        collateral_asset,
        index_asset,
        size_delta,
        is_long,
        acceptable_price
    );

    let fixed_vec = FixedVecAssetIdSize5::from_vec(path);
    log(PositionRouterIncreasePosition {
        account,
        path: fixed_vec,
        index_asset,
        amount_in,
        min_out,
        size_delta,
        is_long,
        acceptable_price,
        block_height: height(),
        timestamp: timestamp()
    });

    (true, false)
}

/// `path` is one of:
///     | [indexAsset, collateralAsset]
///     | [indexAsset]
#[storage(read, write)]
fn _execute_decrease_position(
    path: Vec<AssetId>,
    index_asset: AssetId,
    collateral_delta: u256,
    size_delta: u256,
    is_long: bool,
    receiver: Account,
    acceptable_price: u256,
    min_out: u64,
    disable_eager_revert: bool
) -> (bool, bool) {
    let account = get_sender();

    let (should_execute, is_execution_error) = _validate_execution(
        account,
        disable_eager_revert
    );
    if is_execution_error {
        return (false, true);
    }
    if !should_execute {
        return (false, false);
    }

    let base_position_manager = abi(
        BasePositionManager,
        storage.base_position_manager.read().into()
    );

    let mut amount_out: u256 = base_position_manager.decrease_position(
        account,
        path.get(0).unwrap(),
        index_asset,
        collateral_delta,
        size_delta,
        is_long,
        Account::from(ContractId::this()),
        acceptable_price
    );

    if amount_out > 0 {
        let index_asset = path.get(0).unwrap();
        let collateral_asset = path.get(path.len() - 1).unwrap();

        if path.len() > 1 {
            // swap indexAsset to collateralAsset
            _transfer_out(
                index_asset,
                // @TODO: potential revert here
                u64::try_from(amount_out).unwrap(),
                Account::from(storage.vault.read()),
            );

            amount_out = base_position_manager.swap(
                path,
                min_out,
                Account::from(ContractId::this())
            ).as_u256();
        }

        _transfer_out(
            collateral_asset,
            // @TODO: potential revert here
            u64::try_from(amount_out).unwrap(),
            receiver,
        );
    }

    let fixed_vec = FixedVecAssetIdSize5::from_vec(path);
    log(PositionRouterDecreasePosition {
        account,
        path: fixed_vec,
        index_asset,
        collateral_delta,
        min_out,
        size_delta,
        is_long,
        receiver,
        acceptable_price,
        block_height: height(),
        timestamp: timestamp(),
    });

    (true, false)
}

#[storage(read)]
fn _set_trader_referral_code(_referral_code: b256) {
    let mut _referral_storage = ZERO_CONTRACT;
    {
        let base_position_manager = abi(
            BasePositionManager,
            storage.base_position_manager.read().into()
        );
        _referral_storage = base_position_manager.get_referral_storage();
    }

    if _referral_code == ZERO || _referral_storage == ZERO_CONTRACT {
        return;
    }

    let referral_storage = abi(ReferralStorage, _referral_storage.into());

    let account = get_sender();

    // skip setting of the referral code if the user already has a referral code
    if referral_storage.get_trader_referral_code(account) != ZERO {
        return;
    }

    referral_storage.set_trader_referral_code(account, _referral_code);
}