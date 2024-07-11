// SPDX-License-Identifier: Apache-2.0
contract;
 
use std::{
    block::timestamp,
	call_frames::*,
	context::*, 
	asset::*, 
};
use helpers::{
	context::*,
	transfer::transfer_assets
};
use core_interfaces::vault_pricefeed::*;
 
abi Utils {
	fn get_timestamp() -> u64;

	fn get_contr_balance(
		contr: ContractId,
		asset: AssetId
	) -> u64;

	#[payable]
	fn transfer_assets_to_contract(
		asset: AssetId,
		amount: u64,
		contr: ContractId
	) -> bool;

	fn update_price_data(
		vault_pricefeed_: ContractId,
		price_update_data: Vec<PriceUpdateData>
	);
}

struct PriceUpdateData {
    asset_id: AssetId,
    price: u256,
}

enum Error {
	UtilsInvalidAmountForwarded: (),
	UtilsInvalidAssetForwarded: ()
}

impl Utils for Contract {
	/// Get the internal balance of a specific coin at a specific contract.
	fn get_timestamp() -> u64 {
		timestamp()
	}

	fn get_contr_balance(
		contr: ContractId,
		asset: AssetId
	) -> u64 {
		balance_of(contr, asset)
	}

	#[payable]
	fn transfer_assets_to_contract(
		asset: AssetId,
		amount: u64,
		contr: ContractId
	) -> bool {
		require(
			msg_amount() == amount,
			Error::UtilsInvalidAmountForwarded
		);
		require(
			msg_asset_id() == asset,
			Error::UtilsInvalidAssetForwarded
		);

		transfer_assets(
			asset,
			Account::from(contr),
			amount,
		);

		true
	}

	fn update_price_data(
		vault_pricefeed_: ContractId,
		price_update_data: Vec<PriceUpdateData>
	) {
		let vault_pricefeed = abi(VaultPricefeed, vault_pricefeed_.into());
		let mut i = 0;
		let _len = price_update_data.len();
		while i < _len {
			let data = price_update_data.get(i).unwrap();
			vault_pricefeed.update_price(data.asset_id, data.price);
			i += 1;
		}
	}
} 