// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultStorageForbiddenNotGov: (),
    VaultStorageOnlyAuthorizedEntity: (),
    
    VaultStorageAlreadyInitialized: (),
    VaultStorageInvalidRUSDAsset: (),

    VaultStorageAssetNotWhitelisted: (),
    VaultStorageInvalidLiquidationFeeUsd: (),
    VaultStorageInvalidFeeBasisPoints: (),

    VaultStorageDecimalsAreZero: (),
    VaultStoragePriceQueriedIsZero: (),
}