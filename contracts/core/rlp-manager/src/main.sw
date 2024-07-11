contract;

/*
 ____  _     ____    __  __                                   
|  _ \| |   |  _ \  |  \/  | __ _ _ __   __ _  __ _  ___ _ __ 
| |_) | |   | |_) | | |\/| |/ _` | '_ \ / _` |/ _` |/ _ \ '__|
|  _ <| |___|  __/  | |  | | (_| | | | | (_| | (_| |  __/ |   
|_| \_\_____|_|     |_|  |_|\__,_|_| |_|\__,_|\__, |\___|_|   
                                              |___/
*/

mod events;
mod errors;
mod constants;

use std::{
    block::timestamp,
    call_frames::msg_asset_id,
    context::*,
    revert::require,
    primitive_conversions::u64::*,
    math::*
};
use std::hash::*;
use core_interfaces::{
    rlp_manager::RLPManager,
    shorts_tracker::ShortsTracker,
    vault::Vault,
    vault_storage::VaultStorage,
    vault_utils::VaultUtils,
};
use asset_interfaces::{
    rlp::RLP,
    rusd::RUSD
};
use helpers::{
    math::*,
    context::*,
    utils::*,
    transfer::transfer_assets
};
use events::*;
use errors::*;
use constants::*;

storage { 
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    in_private_mode: bool = false,
    
    rlp: ContractId = ZERO_CONTRACT,
    vault: ContractId = ZERO_CONTRACT,
    shorts_tracker: ContractId = ZERO_CONTRACT,
    rusd: ContractId = ZERO_CONTRACT,

    cooldown_duration: u64 = 0,
    last_added_at: StorageMap<Account, u64> = StorageMap::<Account, u64> {},

    aum_addition: u256 = 0,
    aum_deduction: u256 = 0,

    shorts_tracker_avg_price_weight: u256 = 0,

    is_handler: StorageMap<Account, bool> = StorageMap::<Account, bool> {}
}

impl RLPManager for Contract {
    #[storage(read, write)]
    fn initialize(
        vault: ContractId,
        rusd: ContractId,
        rlp: ContractId,
        shorts_tracker: ContractId,
        cooldown_duration: u64
    ) {
        require(!storage.is_initialized.read(), Error::RLPManagerAlreadyInitialized);
        storage.is_initialized.write(true);

        storage.gov.write(get_sender());
        storage.rlp.write(rlp);
        storage.shorts_tracker.write(shorts_tracker);
        storage.vault.write(vault);
        storage.rusd.write(rusd);
        storage.cooldown_duration.write(cooldown_duration);
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_in_private_mode(in_private_mode: bool) {
        _only_gov();

        storage.in_private_mode.write(in_private_mode);
    }

    #[storage(read, write)]
    fn set_shorts_tracker(shorts_tracker: ContractId) {
        _only_gov();

        storage.shorts_tracker.write(shorts_tracker);
    }

    #[storage(read, write)]
    fn set_shorts_tracker_avg_price_weight(shorts_tracker_avg_price_weight: u64) {
        _only_gov();

        require(
            shorts_tracker_avg_price_weight.as_u256() <= BASIS_POINTS_DIVISOR, 
            Error::RLPManagerInvalidWeight
        );

        storage.shorts_tracker_avg_price_weight.write(shorts_tracker_avg_price_weight.as_u256());
    }

    #[storage(read, write)]
    fn set_handler(handler: Account, is_active: bool) {
        _only_gov();

        require(handler != ZERO_ACCOUNT, Error::RLPManagerHandlerZero);
        storage.is_handler.insert(handler, is_active);
    }

    #[storage(read, write)]
    fn set_cooldown_duration(cooldown_duration: u64) {
        _only_gov();

        require(cooldown_duration <= MAX_COOLDOWN_DURATION, Error::RLPManagerInvalidCooldownDuration);

        storage.cooldown_duration.write(cooldown_duration);
    }

    #[storage(read, write)]
    fn set_aum_adjustment(
        aum_addition: u256,
        aum_deduction: u256
    ) {
        _only_gov();

        storage.aum_addition.write(aum_addition);
        storage.aum_deduction.write(aum_deduction);
    }

    /*
          ____ __     ___
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_price(maximize: bool) -> u256 {
        let aum = _get_aum(maximize);
        let supply = abi(RLP, storage.rlp.read().into()).total_supply();

        (aum * RLP_PRECISION) / supply.as_u256()
    }

    #[storage(read)]
    fn get_aums() -> Vec<u256> {
        let mut vec: Vec<u256> = Vec::new();
        vec.push(_get_aum(true));
        vec.push(_get_aum(false));

        vec
    }

    #[storage(read)]
    fn get_aum_in_rusd(maximize: bool) -> u256 {
        _get_aum_in_rusd(maximize)
    }

    #[storage(read)]
    fn get_rlp() -> ContractId {
        storage.rlp.read()
    }

    #[storage(read)]
    fn get_rusd() -> ContractId {
        storage.rusd.read()
    }

    #[storage(read)]
    fn get_vault() -> ContractId {
        storage.vault.read()
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
    fn add_liquidity(
        asset: AssetId,
        amount: u64,
        min_rusd: u64,
        min_rlp: u64
    ) -> u256 {
        if storage.in_private_mode.read() {
            require(false, Error::RLPManagerForbiddenInPrivateMode);
        }

        _add_liquidity(
            get_sender(),
            get_sender(),
            asset,
            amount,
            min_rusd,
            min_rlp
        )
    }

    #[payable]
    #[storage(read, write)]
    fn add_liquidity_for_account(
        funding_account: Account,
        account: Account,
        asset: AssetId,
        amount: u64,
        min_rusd: u64,
        min_rlp: u64
    ) -> u256 {
        _only_handler();

        _add_liquidity(
            funding_account,
            account,
            asset,
            amount,
            min_rusd,
            min_rlp
        )
    }

    #[storage(read)]
    fn remove_liquidity(
        asset_out: AssetId,
        rlp_amount: u64,
        min_out: u64,
        receiver: Account
    ) -> u256 {
        if storage.in_private_mode.read() {
            require(false, Error::RLPManagerForbiddenInPrivateMode);
        }
        
        _remove_liquidity(
            get_sender(),
            asset_out,
            rlp_amount,
            min_out,
            receiver
        )
    }

    #[storage(read)]
    fn remove_liquidity_for_account(
        account: Account,
        asset_out: AssetId,
        rlp_amount: u64,
        min_out: u64,
        receiver: Account
    ) -> u256 {
        _only_handler();

        _remove_liquidity(
            account,
            asset_out,
            rlp_amount,
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
    require(get_sender() == storage.gov.read(), Error::RLPManagerForbidden);
}

#[storage(read)]
fn _only_handler() {
    require(
        storage.is_handler.get(get_sender()).try_read().unwrap_or(false),
        Error::RLPManagerOnlyHandler
    );
}

#[storage(read)]
fn _get_aum_in_rusd(maximize: bool) -> u256 {
    let aum = _get_aum(maximize);

    aum * 10.pow(RUSD_DECIMALS).as_u256() / PRICE_PRECISION
}

#[storage(read, write)]
fn _add_liquidity(
    _funding_account: Account,
    account: Account,
    asset: AssetId,
    amount: u64,
    min_rusd: u64,
    min_rlp: u64
) -> u256 {
    require(amount > 0, Error::RLPManagerInvalidAmount);
    require(
        msg_asset_id() == asset,
        Error::RLPManagerInvalidAssetForwarded
    );
    require(
        msg_amount() == amount,
        Error::RLPManagerInvalidAssetAmountForwarded
    );

    let rlp = abi(RLP, storage.rlp.read().into());

    // calculate aum before buyRUSD
    let aum_in_rusd = _get_aum_in_rusd(true);
    let rlp_supply = rlp.total_supply();

    // transfer to vault
    transfer_assets(
        asset,
        Account::from(storage.vault.read()),
        amount
    );

    let rusd_amount = abi(Vault, storage.vault.read().into()).buy_rusd(
        asset,
        Account::from(ContractId::this())
    );
    require(
        rusd_amount >= min_rusd.as_u256(),
        Error::RLPManagerInsufficientRUSDOutput
    );

    let mint_amount = if aum_in_rusd == 0 {
        rusd_amount
    } else {
        (rusd_amount * rlp_supply.as_u256()) / aum_in_rusd
    };

    require(
        mint_amount >= min_rlp.as_u256(),
        Error::RLPManagerInsufficientRLPOutput
    );

    storage.last_added_at.insert(account, timestamp());

    // @TODO: potential revert here
    rlp.mint(account, u64::try_from(mint_amount).unwrap());

    log(AddLiquidity {
        account,
        asset,
        amount,
        aum_in_rusd,
        rlp_supply,
        rusd_amount,
        mint_amount
    });

    mint_amount
}

#[storage(read)]
fn _remove_liquidity(
    account: Account,
    asset_out: AssetId,
    rlp_amount: u64,
    min_out: u64,
    receiver: Account
) -> u256 {
    require(rlp_amount > 0, Error::RLPManagerInvalidRlpAmount);
    require(
        storage.last_added_at.get(account).try_read().unwrap_or(0) + storage.cooldown_duration.read() 
            <= timestamp(),
        Error::RLPManagerCooldownDurationNotYetPassed
    );

    let rusd = abi(RUSD, storage.rusd.read().into());
    let vault = abi(Vault, storage.vault.read().into());
    let rlp = abi(RLP, storage.rlp.read().into());

    // calculate aum before sellRUSD
    let aum_in_rusd = _get_aum_in_rusd(false);
    let rlp_supply = rlp.total_supply();

    let rusd_amount = (rlp_amount.as_u256() * aum_in_rusd) / rlp_supply.as_u256();
    let rusd_balance = rusd.balance_of(Account::from(ContractId::this())).as_u256();
    if rusd_amount > rusd_balance {
        // @TODO: potential revert here
        rusd.mint(
            Account::from(ContractId::this()), 
            u64::try_from(rusd_amount - rusd_balance).unwrap()
        );
    }

    rlp.burn(account, rlp_amount);

    // transfer RUSD to vault  
    transfer_assets(
        rusd.get_id(), // the exact AssetId for RUSD
        Account::from(storage.vault.read()),
        // @TODO: potential revert here
        u64::try_from(rusd_amount).unwrap()
    );

    let amount_out = vault.sell_rusd(
        asset_out,
        receiver
    );
    require(amount_out >= min_out.as_u256(), Error::RLPManagerInsufficientOutput);

    log(RemoveLiquidity {
        account,
        asset: asset_out,
        rlp_amount,
        aum_in_rusd,
        rlp_supply,
        rusd_amount,
        amount_out
    });

    amount_out
}

#[storage(read)]
fn _get_aum(maximize: bool) -> u256 {
    let vault = abi(Vault, storage.vault.read().into());
    let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
    let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());

    let length = vault_storage.get_all_whitelisted_assets_length();
    let mut aum = storage.aum_addition.read();
    let mut short_profits: u256 = 0;

    let mut i = 0;
    while i < length {
        let asset = vault_storage.get_whitelisted_asset_by_index(i);
        let is_whitelisted = vault_storage.is_asset_whitelisted(asset);

        if !is_whitelisted {
            i += 1;
            continue;
        }

        let price = if maximize {
            vault_utils.get_max_price(asset)
        } else {
            vault_utils.get_min_price(asset)
        };

        let pool_amount = vault_utils.get_pool_amounts(asset);
        let decimals = vault_storage.get_asset_decimals(asset);

        if vault_storage.is_stable_asset(asset) {
            aum += (pool_amount * price) / 10.pow(decimals.as_u32()).as_u256();
        } else {
            // add global short profit / loss
            let size = vault_utils.get_global_short_sizes(asset);

            if size > 0 {
                let (delta, has_profit) = _get_global_short_delta(asset, price, size);
                if !has_profit {
                    // add losses from shorts
                    aum = aum + delta;
                } else {
                    short_profits += delta;
                }
            }

            aum += vault_utils.get_guaranteed_usd(asset);

            let reserved_amount = vault_utils.get_reserved_amounts(asset);
            aum += ((pool_amount - reserved_amount) * price) / 10.pow(decimals.as_u32()).as_u256();
        }

        i += 1;
    }

    aum = if short_profits > aum { 0 } else { aum - short_profits };

    let aum_deduction = storage.aum_deduction.read();

    if aum_deduction > aum { 0 } else { aum - aum_deduction }
}

#[storage(read)]
fn _get_global_short_delta(
    asset: AssetId,
    price: u256,
    size: u256
) -> (u256, bool) {
    let avg_price = _get_global_short_avg_price(asset);
    let price_delta = if avg_price > price {
        avg_price - price
    } else {
        price - avg_price
    };

    let delta = (size * price_delta) / avg_price;

    (delta, avg_price > price)
}

#[storage(read)]
fn _get_global_short_avg_price(asset: AssetId) -> u256 {
    let vault = abi(Vault, storage.vault.read().into());
    let vault_storage = abi(VaultStorage, vault.get_vault_storage().into());
    let shorts_tracker = abi(ShortsTracker, storage.shorts_tracker.read().into());

    if storage.shorts_tracker.read() == ZERO_CONTRACT || !shorts_tracker.is_global_short_data_ready() {
        return vault_storage.get_global_short_average_prices(asset);
    }

    let vault_average_price = vault_storage.get_global_short_average_prices(asset);
    let shorts_tracker_average_price = shorts_tracker.get_global_short_average_prices(asset);

    let shorts_tracker_average_price_weight = storage.shorts_tracker_avg_price_weight.read();
    if shorts_tracker_average_price_weight == 0 {
        return vault_average_price;
    } else if shorts_tracker_average_price_weight == BASIS_POINTS_DIVISOR {
        return shorts_tracker_average_price;
    }

    vault_average_price
        .mul(BASIS_POINTS_DIVISOR - shorts_tracker_average_price_weight)
        .add(shorts_tracker_average_price * shorts_tracker_average_price_weight)
        .div(BASIS_POINTS_DIVISOR)
}