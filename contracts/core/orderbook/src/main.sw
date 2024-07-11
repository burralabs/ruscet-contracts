// SPDX-License-Identifier: Apache-2.0
contract;

/*
  ___          _           _                 _    
 / _ \ _ __ __| | ___ _ __| |__   ___   ___ | | __
| | | | '__/ _` |/ _ \ '__| '_ \ / _ \ / _ \| |/ /
| |_| | | | (_| |  __/ |  | |_) | (_) | (_) |   < 
 \___/|_|  \__,_|\___|_|  |_.__/ \___/ \___/|_|\_\  
*/

mod events;
mod constants;
mod errors;

use std::{
    block::timestamp,
    call_frames::msg_asset_id,
    context::*,
    revert::require,
    primitive_conversions::u64::*,
};
use std::hash::*;
use core_interfaces::{
    orderbook::*,
    vault::Vault,
    vault_utils::VaultUtils,
    router::Router,
};
use interfaces::wrapped_asset::{
    WrappedAsset as WrappedAssetAbi
};
use helpers::{
    zero::*,
    context::*,
    utils::*,
    signed_64::*,
    math::*,
    transfer::transfer_assets,
    asset::*
};
use events::*;
use constants::*;
use errors::*;

storage {
    // gov is not restricted to an `Address` (EOA) or a `Contract` (external)
    // because this can be either a regular EOA (Address) or a Multisig (Contract)
    gov: Account = ZERO_ACCOUNT,
    is_initialized: bool = false,
    
    vault: ContractId = ZERO_CONTRACT,
    router: ContractId = ZERO_CONTRACT,
    rusd: AssetId = ZERO_ASSET,

    increase_orders: StorageMap<Account, StorageMap<u64, IncreaseOrder>> = 
        StorageMap::<Account, StorageMap<u64, IncreaseOrder>> {},
    increase_orders_index: StorageMap<Account, u64> = StorageMap::<Account, u64> {},

    decrease_orders: StorageMap<Account, StorageMap<u64, DecreaseOrder>> = 
        StorageMap::<Account, StorageMap<u64, DecreaseOrder>> {},
    decrease_orders_index: StorageMap<Account, u64> = StorageMap::<Account, u64> {},

    swap_orders: StorageMap<Account, StorageMap<u64, SwapOrder>> = 
        StorageMap::<Account, StorageMap<u64, SwapOrder>> {},
    swap_orders_index: StorageMap<Account, u64> = StorageMap::<Account, u64> {},
    
    min_execution_fee: u64 = 0,
    min_purchase_asset_amount_usd: u256 = 0
}

impl Orderbook for Contract {
    #[storage(read, write)]
    fn initialize(
        router: ContractId,
        vault: ContractId,
        rusd: AssetId,
        min_execution_fee: u64,
        min_purchase_asset_amount_usd: u64
    ) {
        require(!storage.is_initialized.read(), Error::OrderBookAlreadyInitialized);
        storage.is_initialized.write(true);

        require(vault.non_zero(), Error::OrderBookVaultZero);
        require(router.non_zero(), Error::OrderBookRouterZero);
        require(rusd.non_zero(), Error::OrderBookRusdZero);
        
        storage.router.write(router);
        storage.vault.write(vault);
        storage.rusd.write(rusd);
        storage.min_execution_fee.write(min_execution_fee);
        storage.min_purchase_asset_amount_usd.write(min_purchase_asset_amount_usd.as_u256());

        storage.gov.write(get_sender());

        log(Initialize {
            router,
            vault,
            rusd,
            min_execution_fee,
            min_purchase_asset_amount_usd
        });
    }

    #[storage(read, write)]
    fn set_min_execution_fee(min_execution_fee: u64) {
        _only_gov();
        storage.min_execution_fee.write(min_execution_fee);
        log(UpdateMinExecutionFee { min_execution_fee });
    }

    #[storage(read, write)]
    fn set_min_purchase_asset_amount_usd(min_purchase_asset_amount_usd: u64) {
        _only_gov();
        storage.min_purchase_asset_amount_usd.write(min_purchase_asset_amount_usd.as_u256());
        log(UpdateMinPurchaseAssetAmountUsd { min_purchase_asset_amount_usd });
    }

    /*
          ____     _       _           _       
         / / /    / \   __| |_ __ ___ (_)_ __  
        / / /    / _ \ / _` | '_ ` _ \| | '_ \ 
       / / /    / ___ \ (_| | | | | | | | | | |
      /_/_/    /_/   \_\__,_|_| |_| |_|_|_| |_|                         
    */
    #[storage(read, write)]
    fn set_gov(gov: Account) {
        _only_gov();
        storage.gov.write(gov);
        log(UpdateGov { gov });
    }

    /*
          ____ __     ___  
         / / / \ \   / (_) _____      __
        / / /   \ \ / /| |/ _ \ \ /\ / /
       / / /     \ V / | |  __/\ V  V / 
      /_/_/       \_/  |_|\___| \_/\_/  
    */
    #[storage(read)]
    fn get_swap_order(
        account: Account,
        order_index: u64
    ) -> (
        AssetId, AssetId, AssetId,
        u64, u64, u64,
        bool, bool, u64,
        SwapOrder
    ) {
        let swap_order = storage.swap_orders.get(account).get(order_index)
            .try_read().unwrap_or(SwapOrder::default());
        let length = swap_order.path.len();

        (
            if length > 0 { swap_order.path.get(0) } else { ZERO_ASSET },
            if length > 1 { swap_order.path.get(1) } else { ZERO_ASSET },
            if length > 2 { swap_order.path.get(2) } else { ZERO_ASSET },
            swap_order.amount_in,
            swap_order.min_out,
            swap_order.trigger_ratio,
            swap_order.trigger_above_threshold,
            swap_order.should_unwrap,
            swap_order.execution_fee,
            swap_order
        )
    }

    #[storage(read)]
    fn validate_position_order_price(
        trigger_above_threshold: bool,
        trigger_price: u256,
        index_asset: AssetId,
        maximize_price: bool,
        raise: bool 
    ) -> (u256, bool) {
        _validate_position_order_price(
            trigger_above_threshold,
            trigger_price,
            index_asset,
            maximize_price,
            raise
        )
    }

    #[storage(read)]
    fn get_increase_order(
        account: Account,
        order_index: u64
    ) -> (
        AssetId, u256, AssetId, AssetId,
        u256, bool, u256, bool, 
        u64, IncreaseOrder
    ) {
        let order = storage.increase_orders.get(account).get(order_index)
            .try_read().unwrap_or(IncreaseOrder::default());
        
        (
            order.purchase_asset,
            order.purchase_asset_amount,
            order.collateral_asset,
            order.index_asset,
            order.size_delta,
            order.is_long,
            order.trigger_price,
            order.trigger_above_threshold,
            order.execution_fee,
            order
        )
    }

    #[storage(read)]
    fn get_decrease_order(
        account: Account,
        order_index: u64
    ) -> (
        AssetId, u256, AssetId,
        u256, bool, u256, bool, 
        u64, DecreaseOrder
    ) {
        let order = storage.decrease_orders.get(account).get(order_index)
            .try_read().unwrap_or(DecreaseOrder::default());
        
        (
            order.collateral_asset,
            order.collateral_delta,
            order.index_asset,
            order.size_delta,
            order.is_long,
            order.trigger_price,
            order.trigger_above_threshold,
            order.execution_fee,
            order
        )
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
    fn create_increase_order(
        path: Vec<AssetId>,
        amount_in: u64,
        index_asset: AssetId,
        min_out: u64,
        size_delta: u256,
        collateral_asset: AssetId,
        is_long: bool,
        trigger_price: u256,
        trigger_above_threshold: bool,
        execution_fee: u64,
        should_wrap: bool
    ) {
        _interm_create_increase_order(
            path,
            amount_in,
            index_asset,
            min_out,
            size_delta,
            collateral_asset,
            is_long,
            trigger_price,
            trigger_above_threshold,
            execution_fee,
            should_wrap
        );
    }

    #[storage(read, write)]
    fn update_increase_order(
        order_index: u64,
        size_delta: u256,
        trigger_price: u256,
        trigger_above_threshold: bool
    ) {
        _update_increase_order(
            order_index,
            size_delta,
            trigger_price,
            trigger_above_threshold
        );
    }

    #[storage(read, write)]
    fn cancel_increase_order(order_index: u64) {
        _cancel_increase_order(order_index);
    }

    #[storage(read, write)]
    fn execute_increase_order(
        account: Account,
        order_index: u64,
        fee_receiver: Account
    ) {
        _execute_increase_order(
            account,
            order_index,
            fee_receiver
        );
    }

    #[payable]
    #[storage(read, write)]
    fn create_decrease_order(
        index_asset: AssetId,
        size_delta: u256,
        collateral_asset: AssetId,
        collateral_delta: u256,
        is_long: bool,
        trigger_price: u256,
        trigger_above_threshold: bool,
    ) {
        require(
            msg_asset_id() == AssetId::base(),
            Error::OrderBookInvalidAssetForwarded
        );

        require(
            msg_amount() > storage.min_execution_fee.read(),
            "Orderbook: insufficient execution fee"
        );

        _create_decrease_order(
            get_sender(),
            collateral_asset,
            collateral_delta,
            index_asset,
            size_delta,
            is_long,
            trigger_price,
            trigger_above_threshold
        );
    }

    #[storage(read, write)]
    fn execute_decrease_order(
        account: Account,
        order_index: u64,
        fee_receiver: Account
    ) {
        _execute_decrease_order(
            account,
            order_index,
            fee_receiver
        )
    }

    #[storage(read, write)]
    fn cancel_decrease_order(order_index: u64) {
        _cancel_decrease_order(order_index);
    }

    #[storage(read, write)]
    fn update_decrease_order(
        order_index: u64,
        collateral_delta: u256,
        size_delta: u256,
        trigger_price: u256,
        trigger_above_threshold: bool
    ) {
        _update_decrease_order(
            order_index,
            collateral_delta,
            size_delta,
            trigger_price,
            trigger_above_threshold
        );
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
    require(get_sender() == storage.gov.read(), Error::OrderBookForbidden);
}

#[storage(read)]
fn _validate_position_order_price(
    trigger_above_threshold: bool,
    trigger_price: u256,
    index_asset: AssetId,
    maximize_price: bool,
    raise: bool 
) -> (u256, bool) {
    let vault = abi(Vault, storage.vault.read().into());
    let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());

    let current_price = if maximize_price {
        vault_utils.get_max_price(index_asset)
    } else {
        vault_utils.get_min_price(index_asset)
    };

    let is_price_valid = if trigger_above_threshold {
        current_price > trigger_price
    } else {
        current_price < trigger_price
    };

    if raise {
        require(is_price_valid, Error::OrderBookInvalidPriceForExecution);
    }

    (current_price, is_price_valid)
}

#[storage(read, write)]
fn _interm_create_increase_order(
    path: Vec<AssetId>,
    amount_in: u64,
    index_asset: AssetId,
    min_out: u64,
    size_delta: u256,
    collateral_asset: AssetId,
    is_long: bool,
    trigger_price: u256,
    trigger_above_threshold: bool,
    execution_fee: u64,
    should_wrap: bool
) {
    require(
        msg_asset_id() == AssetId::base(),
        Error::OrderBookInvalidAssetForwarded
    );

    require(
        execution_fee >= storage.min_execution_fee.read(),
        Error::OrderBookInsufficientExecutionFee
    );

    if (should_wrap) {
        require(
            path.get(0).unwrap() == AssetId::base(),
            Error::OrderBookPath0ShouldBeETH
        );
        require(msg_amount() == execution_fee + amount_in, Error::OrderBookIncorrectValueTransferred);
    } else {
        require(msg_amount() == execution_fee, Error::OrderBookIncorrectExecutionFeeTransferred);
        abi(Router, storage.router.read().into())
            .plugin_transfer(
                path.get(0).unwrap(),
                get_sender(),
                Account::from(ContractId::this()),
                amount_in
            );
    }

    let purchase_asset = path.get(path.len() - 1).unwrap();
    let mut purchase_asset_amount: u256 = 0;
    if path.len() > 1 {
        let asset = path.get(0).unwrap();

        require(
            path.get(0).unwrap() != purchase_asset,
            Error::OrderBookInvalidPath
        );

        require(
            msg_asset_id() == asset,
            Error::OrderBookInvalidMsgAsset
        );

        require(
            msg_amount() == amount_in,
            Error::OrderBookInvalidMsgAmount
        );

        transfer_assets(
            asset,
            Account::from(storage.vault.read()),
            amount_in
        );

        purchase_asset_amount = _swap(
            path,
            min_out,
            Account::from(ContractId::this())
        );
    } else {
        purchase_asset_amount = amount_in.as_u256();
    }

    let vault = abi(Vault, storage.vault.read().into());
    let vault_utils = abi(VaultUtils, vault.get_vault_utils().into());

    let purchase_asset_amount_usd = vault_utils.asset_to_usd_min(
        purchase_asset,
        purchase_asset_amount
    );
    require(
        purchase_asset_amount_usd >= storage.min_purchase_asset_amount_usd.read(),
        Error::OrderBookInsufficientCollateral
    );

    _create_increase_order(
        get_sender(),
        purchase_asset,
        purchase_asset_amount,
        collateral_asset,
        index_asset,
        size_delta,
        is_long,
        trigger_price,
        trigger_above_threshold,
        execution_fee
    );
}

#[storage(read, write)]
fn _create_increase_order(
    account: Account,
    purchase_asset: AssetId,
    purchase_asset_amount: u256,
    collateral_asset: AssetId,
    index_asset: AssetId,
    size_delta: u256,
    is_long: bool,
    trigger_price: u256,
    trigger_above_threshold: bool,
    execution_fee: u64,
) {
    let order_index = storage.increase_orders_index
        .get(get_sender()).try_read().unwrap_or(0);

    let order = IncreaseOrder {
        account,
        purchase_asset,
        purchase_asset_amount,
        collateral_asset,
        index_asset,
        size_delta,
        is_long,
        trigger_price,
        trigger_above_threshold,
        execution_fee
    };

    storage.increase_orders_index.insert(account, order_index + 1);
    storage.increase_orders.get(account).insert(order_index, order);

    log(CreateIncreaseOrder {
        account,
        order_index,
        purchase_asset,
        purchase_asset_amount,
        collateral_asset,
        index_asset,
        size_delta,
        is_long,
        trigger_price,
        trigger_above_threshold,
        execution_fee
    });
}

#[storage(read, write)]
fn _execute_increase_order(
    address: Account,
    order_index: u64,
    fee_receiver: Account
) {
    let order = storage.increase_orders.get(address).get(order_index)
        .try_read().unwrap_or(IncreaseOrder::default());

    require(
        order.account != ZERO_ACCOUNT,
        Error::OrderBookOrderDoesntExist
    ); 

    // increase long should use max price
    // increase short should use min price
    let (current_price, _) = _validate_position_order_price(
        order.trigger_above_threshold,
        order.trigger_price,
        order.index_asset,
        order.is_long,
        true
    );

    storage.increase_orders.get(address).remove(order_index);

    transfer_assets(
        order.purchase_asset,
        Account::from(storage.vault.read()),
        // @TODO: potential revert here
        u64::try_from(order.purchase_asset_amount).unwrap()
    );

    if order.purchase_asset != order.collateral_asset {
        let mut path: Vec<AssetId> = Vec::new();
        path.push(order.purchase_asset);
        path.push(order.collateral_asset);

        let amount_out = _swap(
            path,
            0,
            Account::from(ContractId::this())
        );
        transfer_assets(
            order.collateral_asset,
            Account::from(storage.vault.read()),
            // @TODO: potential revert here
            u64::try_from(amount_out).unwrap()
        );
    }

    let router = abi(Router, storage.router.read().into());
    router.plugin_increase_position(
        order.account,
        order.collateral_asset,
        order.index_asset,
        order.size_delta,
        order.is_long
    );

    // pay execution_fee to executor
    _transfer_out_eth(fee_receiver, order.execution_fee);

    log(ExecuteIncreaseOrder {
        account: order.account,
        order_index,
        purchase_asset: order.purchase_asset,
        purchase_asset_amount: order.purchase_asset_amount,
        collateral_asset: order.collateral_asset,
        index_asset: order.index_asset,
        is_long: order.is_long,
        size_delta: order.size_delta,
        trigger_price: order.trigger_price,
        trigger_above_threshold: order.trigger_above_threshold,
        execution_fee: order.execution_fee,
        execution_price: current_price
    });
}

#[storage(read, write)]
fn _update_increase_order(
    order_index: u64,
    size_delta: u256,
    trigger_price: u256,
    trigger_above_threshold: bool
) {
    let mut order = storage.increase_orders.get(get_sender()).get(order_index)
        .try_read().unwrap_or(IncreaseOrder::default());
    
    require(
        order.account != ZERO_ACCOUNT,
        Error::OrderBookOrderDoesntExist
    );

    order.trigger_price = trigger_price;
    order.trigger_above_threshold = trigger_above_threshold;
    order.size_delta = size_delta;

    storage.increase_orders.get(get_sender()).insert(order_index, order);

    log(UpdateIncreaseOrder {
        account: get_sender(),
        order_index,
        collateral_asset: order.collateral_asset,
        index_asset: order.index_asset,
        is_long: order.is_long,
        size_delta,
        trigger_price,
        trigger_above_threshold
    });
}

#[storage(read, write)]
fn _cancel_increase_order(order_index: u64) {
    let order = storage.increase_orders.get(get_sender()).get(order_index)
        .try_read().unwrap_or(IncreaseOrder::default());

    require(
        order.account != ZERO_ACCOUNT,
        Error::OrderBookOrderDoesntExist
    );

    storage.increase_orders.get(get_sender()).remove(order_index);

    transfer_assets(
        order.purchase_asset,
        get_sender(),
        // @TODO: potential revert here
        u64::try_from(order.purchase_asset_amount).unwrap()
    );

    // transfer execution fee
    _transfer_out_eth(get_sender(), order.execution_fee);

    log(CancelIncreaseOrder {
        account: order.account,
        order_index,
        purchase_asset: order.purchase_asset,
        purchase_asset_amount: order.purchase_asset_amount,
        collateral_asset: order.collateral_asset,
        index_asset: order.index_asset,
        is_long: order.is_long,
        size_delta: order.size_delta,
        trigger_price: order.trigger_price,
        trigger_above_threshold: order.trigger_above_threshold,
        execution_fee: order.execution_fee
    });
}
 
#[storage(read, write)]
fn _create_decrease_order(
    account: Account,
    collateral_asset: AssetId,
    collateral_delta: u256,
    index_asset: AssetId,
    size_delta: u256,
    is_long: bool,
    trigger_price: u256,
    trigger_above_threshold: bool,
) {
    let order_index = storage.decrease_orders_index
        .get(get_sender()).try_read().unwrap_or(0);

    let order = DecreaseOrder {
        account,
        collateral_asset,
        collateral_delta,
        index_asset,
        size_delta,
        is_long,
        trigger_price,
        trigger_above_threshold,
        execution_fee: msg_amount()
    };

    storage.decrease_orders_index.insert(account, order_index + 1);
    storage.decrease_orders.get(account).insert(order_index, order);

    log(CreateDecreaseOrder {
        account,
        order_index,
        collateral_asset,
        collateral_delta,
        index_asset,
        size_delta,
        is_long,
        trigger_price,
        trigger_above_threshold,
        execution_fee: msg_amount()
    });
}

#[storage(read, write)]
fn _execute_decrease_order(
    account: Account,
    order_index: u64,
    fee_receiver: Account
) {
    let order = storage.decrease_orders.get(account).get(order_index)
        .try_read().unwrap_or(DecreaseOrder::default());
    
    require(
        order.account != ZERO_ACCOUNT,
        Error::OrderBookOrderDoesntExist
    );

    // decrease long should use min price
    // decrease short should use max price
    let (current_price, _) = _validate_position_order_price(
        order.trigger_above_threshold,
        order.trigger_price,
        order.index_asset,
        !order.is_long,
        true
    );

    storage.decrease_orders.get(account).remove(order_index);

    let router = abi(Router, storage.router.read().into());
    let amount_out = router.plugin_decrease_position(
        order.account,
        order.collateral_asset,
        order.index_asset,
        order.collateral_delta,
        order.size_delta,
        order.is_long,
        Account::from(ContractId::this())
    );

    // transfer released collateral to user
    transfer_assets(
        order.collateral_asset,
        order.account,
        // @TODO: potential revert here
        u64::try_from(amount_out).unwrap()
    );

    // pay executor
    _transfer_out_eth(fee_receiver, order.execution_fee);

    log(ExecuteDecreaseOrder {
        account: order.account,
        order_index,
        collateral_asset: order.collateral_asset,
        collateral_delta: order.collateral_delta,
        index_asset: order.index_asset,
        size_delta: order.size_delta,
        is_long: order.is_long,
        trigger_price: order.trigger_price,
        trigger_above_threshold: order.trigger_above_threshold,
        execution_fee: order.execution_fee,
        execution_price: current_price
    });
}

#[storage(read, write)]
fn _cancel_decrease_order(order_index: u64) {
    let order = storage.decrease_orders.get(get_sender()).get(order_index)
        .try_read().unwrap_or(DecreaseOrder::default());
    
    require(
        order.account != ZERO_ACCOUNT,
        Error::OrderBookOrderDoesntExist
    );

    storage.decrease_orders.get(get_sender()).remove(order_index);

    _transfer_out_eth(get_sender(), order.execution_fee);

    log(CancelDecreaseOrder {
        account: order.account,
        order_index,
        collateral_asset: order.collateral_asset,
        collateral_delta: order.collateral_delta,
        index_asset: order.index_asset,
        size_delta: order.size_delta,
        is_long: order.is_long,
        trigger_price: order.trigger_price,
        trigger_above_threshold: order.trigger_above_threshold,
        execution_fee: order.execution_fee
    });
}

#[storage(read, write)]
fn _update_decrease_order(
    order_index: u64,
    collateral_delta: u256,
    size_delta: u256,
    trigger_price: u256,
    trigger_above_threshold: bool
) {
    let mut order = storage.decrease_orders.get(get_sender()).get(order_index)
        .try_read().unwrap_or(DecreaseOrder::default());

    require(
        order.account != ZERO_ACCOUNT,
        Error::OrderBookOrderDoesntExist
    );

    order.trigger_price = trigger_price;
    order.trigger_above_threshold = trigger_above_threshold;
    order.size_delta = size_delta;
    order.collateral_delta = collateral_delta;

    storage.decrease_orders.get(get_sender()).insert(order_index, order);

    log(UpdateDecreaseOrder {
        account: get_sender(),
        order_index,
        collateral_asset: order.collateral_asset,
        collateral_delta,
        index_asset: order.index_asset,
        is_long: order.is_long,
        size_delta,
        trigger_price,
        trigger_above_threshold
    });
}

#[storage(read)]
fn _swap(
    path: Vec<AssetId>,
    min_out: u64,
    receiver: Account
) -> u256 {
    let len = path.len();

    if len == 2 {
        return _vault_swap(
            path.get(0).unwrap(),
            path.get(1).unwrap(),
            min_out,
            receiver
        );
    }

    if len == 3 {
        let mid_out = _vault_swap(
            path.get(0).unwrap(),
            path.get(1).unwrap(),
            0,
            Account::from(ContractId::this())
        );

        transfer_assets(
            path.get(1).unwrap(),
            Account::from(storage.vault.read()),
            // @TODO: potential revert here
            u64::try_from(mid_out).unwrap()
        );

        return _vault_swap(
            path.get(1).unwrap(),
            path.get(2).unwrap(),
            min_out,
            receiver
        );

    }

    require(false, Error::OrderBookInvalidPathLen);
    0
}

#[storage(read)]
fn _vault_swap(
    asset_in: AssetId,
    asset_out: AssetId,
    min_out: u64,
    receiver: Account
) -> u256 {
    let mut amount_out: u256 = 0;

    let vault = abi(Vault, storage.vault.read().into());

    if asset_in == storage.rusd.read() {
        // buy RUSD
        amount_out = vault.buy_rusd(asset_in, receiver);
    } else if asset_out == storage.rusd.read() {
        // sell RUSD
        amount_out = vault.sell_rusd(asset_out, receiver);
    } else { 
        // swap
        amount_out = vault.swap(asset_in, asset_out, receiver).as_u256();
    }

    require(amount_out >= min_out.as_u256(), Error::OrderBookInsufficientAmountOut);

    amount_out
}

fn _transfer_out_eth(
    receiver: Account,
    amount_out: u64
) {
    transfer_assets(
        AssetId::base(),
        receiver,
        amount_out
    );
}