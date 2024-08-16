// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultStorageForbiddenNotGov: (),
    VaultStorageOnlyAuthorizedEntity: (),
    
    VaultStorageAlreadyInitialized: (),
    VaultStorageInvalidRUSDAsset: (),
    VaultStorageZeroAsset: (),

    VaultStorageMaxRusdExceeded: (),
    
    VaultStorageInvalidTaxBasisPoints: (),
    VaultStorageInvalidStableTaxBasisPoints: (),
    VaultStorageInvalidMintBurnFeeBasisPoints: (),
    VaultStorageInvalidSwapFeeBasisPoints: (),
    VaultStorageInvalidStableSwapFeeBasisPoints: (),
    VaultStorageInvalidMarginFeeBasisPoints: (),
    VaultStorageInvalidLiquidationFeeUsd: (),

    VaultStorageInvalidFundingRateFactor: (),
    VaultStorageInvalidStableFundingRateFactor: (),

    VaultStorageAssetNotWhitelisted: (),
    VaultStoragePricefeedZero: (),
}