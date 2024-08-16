// SPDX-License-Identifier: Apache-2.0
library;

use ::errors::*;
use ::constants::*;

pub fn _verify_fees(
    tax_basis_points: u64,
    stable_tax_basis_points: u64,
    mint_burn_fee_basis_points: u64,
    swap_fee_basis_points: u64,
    stable_swap_fee_basis_points: u64,
    margin_fee_basis_points: u64,
    liquidation_fee_usd: u256,
    min_profit_time: u64,
    has_dynamic_fees: bool,
) {
    require(tax_basis_points <= MAX_FEE_BASIS_POINTS, Error::VaultStorageInvalidTaxBasisPoints);
    require(stable_tax_basis_points <= MAX_FEE_BASIS_POINTS, Error::VaultStorageInvalidStableTaxBasisPoints);
    require(mint_burn_fee_basis_points <= MAX_FEE_BASIS_POINTS, Error::VaultStorageInvalidMintBurnFeeBasisPoints);
    require(swap_fee_basis_points <= MAX_FEE_BASIS_POINTS, Error::VaultStorageInvalidSwapFeeBasisPoints);
    require(stable_swap_fee_basis_points <= MAX_FEE_BASIS_POINTS, Error::VaultStorageInvalidStableSwapFeeBasisPoints);
    require(margin_fee_basis_points <= MAX_FEE_BASIS_POINTS, Error::VaultStorageInvalidMarginFeeBasisPoints);
    require(liquidation_fee_usd <= MAX_LIQUIDATION_FEE_USD, Error::VaultStorageInvalidLiquidationFeeUsd);
}