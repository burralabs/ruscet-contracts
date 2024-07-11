// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____                   ____           _ _   _               __  __                                   
| __ )  __ _ ___  ___  |  _ \ ___  ___(_) |_(_) ___  _ __   |  \/  | __ _ _ __   __ _  __ _  ___ _ __ 
|  _ \ / _` / __|/ _ \ | |_) / _ \/ __| | __| |/ _ \| '_ \  | |\/| |/ _` | '_ \ / _` |/ _` |/ _ \ '__|
| |_) | (_| \__ \  __/ |  __/ (_) \__ \ | |_| | (_) | | | | | |  | | (_| | | | | (_| | (_| |  __/ |   
|____/ \__,_|___/\___| |_|   \___/|___/_|\__|_|\___/|_| |_| |_|  |_|\__,_|_| |_|\__,_|\__, |\___|_|   
                                                                                      |___/        
*/

mod events;
mod constants;
mod errors;

use std::{
    block::timestamp,
    call_frames::msg_asset_id,
    context::*,
    revert::require,
};
use std::hash::*;
use core_interfaces::{
    base_position_manager::BasePositionManager,
    vault::Vault,
    vault_storage::VaultStorage,
    vault_utils::VaultUtils,
    router::Router,
    shorts_tracker::ShortsTracker,
};
use referrals_interfaces::referral_storage::ReferralStorage;
use helpers::{
    context::*, 
    zero::*, 
    utils::*, 
    transfer::*, 
    math::*,
    signed_256::Signed256
};
use events::*;
use constants::*;
use errors::*;

storage {
    // gov is not restricted to an `Account` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Account) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,
    // because `BasePositionManager` is supposed to be a Base inheritance contract
    // and Sway doesn't support inheritance, we simulate inheritance by 
    // restricting certain functions to the `child`
    child: ContractId = ZERO_CONTRACT,
    is_initialized: bool = false,
    child_registered: bool = false,
    
    vault: ContractId = ZERO_CONTRACT,
    shorts_tracker: ContractId = ZERO_CONTRACT,
    router: ContractId = ZERO_CONTRACT,
    referral_storage: ContractId = ZERO_CONTRACT,

    // to prevent using the deposit and withdrawal of collateral as a zero fee swap,
    // there is a small depositFee charged if a collateral deposit results in the decrease
    // of leverage for an existing position
    // increase_position_buffer_bps allows for a small amount of decrease of leverage
    deposit_fee: u64 = 0,
    increase_position_buffer_bps: u64 = 100,

    fee_reserves: StorageMap<AssetId, u64> = StorageMap::<AssetId, u64> {},
    
    max_global_long_sizes: StorageMap<AssetId, u256> = StorageMap::<AssetId, u256> {},
    max_global_short_sizes: StorageMap<AssetId, u256> = StorageMap::<AssetId, u256> {},
    
    is_handler: StorageMap<Account, bool> = StorageMap::<Account, bool> {}
}

impl BasePositionManager for Contract {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        vault: ContractId,
        router: ContractId,
        shorts_tracker: ContractId,
        referral_storage: ContractId,
        deposit_fee: u64
    ) {
        require(
            !storage.is_initialized.read(),
            Error::BPMAlreadyInitialized
        );
        storage.is_initialized.write(true);

        storage.gov.write(gov);
        storage.vault.write(vault);
        storage.router.write(router);
        storage.shorts_tracker.write(shorts_tracker);
        storage.referral_storage.write(referral_storage);
        storage.deposit_fee.write(deposit_fee);
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
    fn register_child(child: ContractId) {
        _only_gov();
        require(
            !storage.child_registered.read(),
            Error::BPMChildAlreadyRegistered
        );
        storage.child_registered.write(true);

        storage.child.write(child);
    }

    #[storage(read, write)]
    fn set_deposit_fee(deposit_fee: u64) {
        _only_gov();

        storage.deposit_fee.write(deposit_fee);
        log(SetDepositFee { deposit_fee });
    }

    #[storage(read, write)]
    fn set_increase_position_buffer_bps(
        increase_position_buffer_bps: u64
    ) {
        _only_gov();
        
        storage.increase_position_buffer_bps.write(increase_position_buffer_bps);
        log(SetIncreasePositionBufferBps {
            increase_position_buffer_bps
        });
    }

    #[storage(read, write)]
    fn set_referral_storage(referral_storage: ContractId) {
        _only_gov();

        storage.referral_storage.write(referral_storage);
        log(SetReferralStorage { referral_storage });
    }

    #[storage(read, write)]
    fn set_max_global_sizes(
        assets: Vec<AssetId>,
        long_sizes: Vec<u256>,
        short_sizes: Vec<u256>
    ) {
        _only_gov();

        require(
            assets.len() == long_sizes.len() && assets.len() == long_sizes.len() && assets.len() == short_sizes.len(),
            Error::BPMIncorrectLength
        );

        let mut i = 0;
        while i < assets.len() {
            let asset = assets.get(i).unwrap();
            storage.max_global_long_sizes.insert(
                asset,
                long_sizes.get(i).unwrap()
            );
            storage.max_global_short_sizes.insert(
                asset,
                short_sizes.get(i).unwrap()
            );
            i += 1;
        }

        log(SetMaxGlobalSize {
            assets,
            long_sizes,
            short_sizes
        });
    }

    #[storage(read, write)]
    fn withdraw_fees(
        asset: AssetId,
        receiver: Account 
    ) {
        _only_gov();

        let amount = storage.fee_reserves.get(asset).try_read().unwrap_or(0);
        if amount == 0 {
            return;
        }

        storage.fee_reserves.insert(asset, 0);

        transfer_assets(
            asset,
            receiver,
            amount
        );

        log(WithdrawFees {
            asset,
            receiver,
            amount
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
    fn get_referral_storage() -> ContractId {
        storage.referral_storage.read()
    }

    #[storage(read)]
    fn get_max_global_long_sizes(asset: AssetId) -> u256 {
        storage.max_global_long_sizes.get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_max_global_short_sizes(asset: AssetId) -> u256 {
        storage.max_global_short_sizes.get(asset).try_read().unwrap_or(0)
    }

    #[storage(read)]
    fn get_fee_reserves(asset: AssetId) -> u64 {
        storage.fee_reserves.get(asset).try_read().unwrap_or(0)
    }

    /*
          ____  ____        _     _ _      
         / / / |  _ \ _   _| |__ | (_) ___ 
        / / /  | |_) | | | | '_ \| | |/ __|
       / / /   |  __/| |_| | |_) | | | (__ 
      /_/_/    |_|    \__,_|_.__/|_|_|\___|
    */
    #[payable]
    #[storage(read, write)]
    fn collect_fees(
        account: Account,
        path: Vec<AssetId>,
        amount_in: u64,
        index_asset: AssetId,
        is_long: bool,
        size_delta: u256
    ) -> u64 {
        _only_child();

        require(
            path.len() > 0,
            Error::BPMInvalidPathLen
        );

        _collect_fees(
            account,
            path,
            amount_in,
            index_asset,
            is_long,
            size_delta
        )
    }

    #[payable]
    #[storage(read)]
    fn increase_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        size_delta: u256,
        is_long: bool,
        price: u256 
    ) {
        _only_child();

        _increase_position(
            account,
            collateral_asset,
            index_asset,
            size_delta,
            is_long,
            price
        )
    }

    #[payable]
    #[storage(read)]
    fn decrease_position(
        account: Account,
        collateral_asset: AssetId,
        index_asset: AssetId,
        collateral_delta: u256,
        size_delta: u256,
        is_long: bool,
        receiver: Account,
        price: u256 
    ) -> u256 {
        _only_child();
        
        _decrease_position(
            account,
            collateral_asset,
            index_asset,
            collateral_delta,
            size_delta,
            is_long,
            receiver,
            price,
        )
    }

    #[payable]
    #[storage(read)]
    fn swap(
        path: Vec<AssetId>,
        min_out: u64,
        receiver: Account
    ) -> u64 {
        _only_child();
        
        _swap(
            path,
            min_out,
            receiver
        )
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
    require(get_sender() == storage.gov.read(), Error::BPMForbidden);
}

#[storage(read)]
fn _only_child() {
    require(
        get_contract_or_revert() == storage.child.read(), 
        Error::BPMOnlyChildContract
    );
}

#[storage(read)]
fn _validate_max_global_size(
    index_asset: AssetId,
    is_long: bool,
    size_delta: u256
) {
    if size_delta == 0 {
        return;
    }

    let vault = abi(Vault, storage.vault.read().into());
    let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());

    if is_long {
        let max_global_long_size = storage.max_global_long_sizes.get(index_asset).try_read().unwrap_or(0);
        let val = vault_utils.get_guaranteed_usd(index_asset) + size_delta;

        if max_global_long_size > 0 && val > max_global_long_size {
            require(false, Error::BPMMaxLongsExceeded);
        }
    } else {
        let max_global_short_size = storage.max_global_short_sizes.get(index_asset).try_read().unwrap_or(0);
        let val = vault_utils.get_global_short_sizes(index_asset) + size_delta;

        if max_global_short_size > 0 && val > max_global_short_size {
            require(false, Error::BPMMaxShortsExceeded);
        }
    }
}

#[storage(read)]
fn _increase_position(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    size_delta: u256,
    is_long: bool,
    price: u256 
) {
    _validate_max_global_size(index_asset, is_long, size_delta);

    let vault = abi(Vault, storage.vault.read().into());
    let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());
    let router = abi(Router, storage.router.read().into());
    let shorts_tracker = abi(ShortsTracker, storage.shorts_tracker.read().into());

    let mark_price = if is_long { vault_utils.get_max_price(index_asset) } else { vault_utils.get_min_price(index_asset) };
    if is_long {
        require(mark_price <= price, Error::BPMMarkPriceGtPrice);
    } else {
        require(mark_price >= price, Error::BPMMarkPriceLtPrice);
    }

    // @TODO: make sure gov is a timelock
    // let timelock = vault.gov();

    // should be called strictly before position is updated in Vault
    shorts_tracker.update_global_short_data(
        account,
        collateral_asset,
        index_asset,
        is_long,
        size_delta,
        mark_price,
        true
    );

    // @TODO
    // timelock.enable_leverage(vault);

    router.plugin_increase_position(
        account,
        collateral_asset,
        index_asset,
        size_delta,
        is_long,
    );

    // @TODO
    // timelock.disable_leverage(vault);

    _emit_increase_position_referral(account, size_delta);
}

#[storage(read)]
fn _decrease_position(
    account: Account,
    collateral_asset: AssetId,
    index_asset: AssetId,
    collateral_delta: u256,
    size_delta: u256,
    is_long: bool,
    receiver: Account,
    price: u256 
) -> u256 {
    let vault = abi(Vault, storage.vault.read().into());
    let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());
    let router = abi(Router, storage.router.read().into());
    let shorts_tracker = abi(ShortsTracker, storage.shorts_tracker.read().into());

    let mark_price = if is_long { vault_utils.get_min_price(index_asset) } else { vault_utils.get_max_price(index_asset) };
    if is_long {
        require(mark_price >= price, Error::BPMMarkPriceLtPrice)
    } else {
        require(mark_price <= price, Error::BPMMarkPriceGtPrice)
    }

    // @TODO: make sure gov is a timelock
    // let timelock = vault.gov();

    // should be called strictly before position is updated in Vault
    shorts_tracker.update_global_short_data(
        account,
        collateral_asset,
        index_asset,
        is_long,
        size_delta,
        mark_price,
        false
    );

    // @TODO
    // timelock.enable_leverage(vault);
    
    let amount_out = router.plugin_decrease_position(
        account,
        collateral_asset,
        index_asset,
        collateral_delta,
        size_delta,
        is_long,
        receiver
    );

    // @TODO
    // timelock.disable_leverage(vault);

    _emit_decrease_position_referral(account, size_delta);

    amount_out
}

#[storage(read, write)]
fn _collect_fees(
    account: Account,
    path: Vec<AssetId>,
    amount_in: u64,
    index_asset: AssetId,
    is_long: bool,
    size_delta: u256 
) -> u64 {
    let should_deduct_fee = _should_deduct_fee(
        account,
        path,
        amount_in,
        index_asset,
        is_long,
        size_delta
    );

    let fee_asset = path.get(path.len() - 1).unwrap();

    if should_deduct_fee {
        let after_fee_amount = amount_in * (BASIS_POINTS_DIVISOR - storage.deposit_fee.read()) / BASIS_POINTS_DIVISOR;
        let fee_amount = amount_in - after_fee_amount;

        require(
            msg_asset_id() == fee_asset,
            Error::BPMInvalidAssetForwarded
        );
        require(
            msg_amount() >= fee_amount,
            Error::BPMInvalidAssetAmountForwardedToCoverFeeAmount
        );

        storage.fee_reserves.insert(
            fee_asset,
            storage.fee_reserves.get(fee_asset).try_read().unwrap_or(0) + fee_amount
        );

        // transfer out excess fees to the sender
        transfer_assets(
            fee_asset,
            get_sender(),
            msg_amount() - fee_amount
        );

        return after_fee_amount;
    } else {
        // transfer out the entire amount back to the sender
        transfer_assets(
            fee_asset,
            get_sender(),
            msg_amount()
        );
    }

    amount_in
}

#[storage(read)]
fn _should_deduct_fee(
    account: Account,
    path: Vec<AssetId>,
    amount_in: u64,
    index_asset: AssetId,
    is_long: bool,
    size_delta: u256
) -> bool {
    // if the position is a short, do not charge a fee
    if !is_long { 
        return false;
    }

    // if the position size is not increasing, this is a collateral deposit
    if size_delta == 0 {
        return true;
    }

    let collateral_asset = path.get(path.len() - 1).unwrap();

    let vault = abi(Vault, storage.vault.read().into());
    let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());
    let (size, collateral, _, _, _, _, _, _) = vault_utils.get_position(account, collateral_asset, index_asset, is_long);

    // if there is no existing position, do not charge a fee
    if size == 0 {
        return false;
    }

    let next_size = size + size_delta;
    let collateral_delta = vault_utils.asset_to_usd_min(collateral_asset, amount_in.as_u256());
    let next_collateral = collateral + collateral_delta;

    let prev_leverage = size * BASIS_POINTS_DIVISOR.as_u256() / collateral;
    // allow for a maximum of a increasePositionBufferBps decrease since there might be 
    // some swap fees taken from the collateral
    let next_leverage = next_size *
        (BASIS_POINTS_DIVISOR.as_u256() + storage.increase_position_buffer_bps.read().as_u256()) / next_collateral;

    log(LeverageDecreased {
        collateral_delta,
        prev_leverage,
        next_leverage
    });

    // deduct a fee if the leverage is decreased
    next_leverage < prev_leverage
}

#[storage(read)]
fn _emit_increase_position_referral(
    account: Account,
    size_delta: u256
) {
    let _referral_storage = storage.referral_storage.read();
    if _referral_storage == ZERO_CONTRACT {
        return;
    }

    let referral_storage = abi(ReferralStorage, _referral_storage.into());
    let (referral_code, referrer) = referral_storage.get_trader_referral_info(account);
    if referral_code == ZERO {
        return;
    }

    let mut margin_fee_basis_points = 0;
    {
        let vault = abi(Vault, storage.vault.read().into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());

        margin_fee_basis_points = vault_storage.get_margin_fee_basis_points();
    }

    log(IncreasePositionReferral {
        account,
        size_delta,
        margin_fee_basis_points,
        referral_code,
        referrer
    });
}

#[storage(read)]
fn _emit_decrease_position_referral(
    account: Account,
    size_delta: u256
) {
    let _referral_storage = storage.referral_storage.read();
    if _referral_storage == ZERO_CONTRACT {
        return;
    }

    let referral_storage = abi(ReferralStorage, _referral_storage.into());
    let (referral_code, referrer) = referral_storage.get_trader_referral_info(account);
    if referral_code == ZERO {
        return;
    }

    let mut margin_fee_basis_points = 0;
    {
        let vault = abi(Vault, storage.vault.read().into());
        let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());

        margin_fee_basis_points = vault_storage.get_margin_fee_basis_points();
    }

    log(DecreasePositionReferral {
        account,
        size_delta,
        margin_fee_basis_points,
        referral_code,
        referrer
    });
}

#[storage(read)]
fn _swap(
    path: Vec<AssetId>,
    min_out: u64,
    receiver: Account
) -> u64 {
    if path.len() == 2 {
        return _vault_swap(
            path.get(0).unwrap(),
            path.get(1).unwrap(),
            min_out,
            receiver
        );
    }

    require(false, Error::BPMIncorrectPathLength);
    0
}

#[storage(read)]
fn _vault_swap(
    asset_in: AssetId,
    asset_out: AssetId,
    min_out: u64,
    receiver: Account
) -> u64 {
    let amount_out = abi(Vault, storage.vault.read().into()).swap(
        asset_in,
        asset_out,
        receiver
    );

    require(
        amount_out >= min_out,
        Error::BPMInvalidAmountOut,
    );

    amount_out
}