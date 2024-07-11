// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    WrappedAssetAlreadyInitialized: (),
    WrappedAssetZeroAsset: (),
    WrappedAssetInvalidAsset: (),
    WrappedAssetInsufficientBalance: (),
    WrappedAssetInsufficientAllowance: (),
}