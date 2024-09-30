// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultForbiddenNotGov: (),
    VaultAlreadyInitialized: (),
    VaultInvalidMsgCaller: (),
    VaultReentrantCall: (),

    VaultReceiverCannotBeZero: (),

    VaultAssetNotWhitelisted: (),
    VaultInvalidRusdAmount: (),
    VaultInvalidRedemptionAmount: (),

    VaultInvalidAssetForwarded: (),
    VaultZeroAmountOfAssetForwarded: (),

    VaultInvalidAmountOut: (),

    VaultInvalidMintAmountGtU64Max: (),
    VaultInvalidRUSDBurnAmountGtU64Max: (),

    VaultPoolAmountLtBuffer: (),

    VaultInvalidAmountIn: (),

    VaultAssetInNotWhitelisted: (),
    VaultAssetOutNotWhitelisted: (),
    VaultAssetsAreEqual: (),

    VaultInsufficientCollateralForFees: (),

    VaultAccountCannotBeZero: (),

    VaultCollateralShouldBeWithdrawn: (),
    VaultSizeMustBeMoreThanCollateral: (),
    
    VaultInvalidPosition: (),
    VaultInvalidPositionSize: (),

    VaultCollateralAssetNotWhitelisted: (),

    VaultLongCollateralIndexAssetsMismatch: (),
    VaultLongCollateralAssetMustNotBeStableAsset: (),

    VaultShortCollateralAssetMustBeStableAsset: (),
    VaultShortIndexAssetMustNotBeStableAsset: (),
    VaultShortIndexAssetNotShortable: (),

    VaultPositionCannotBeLiquidated: (),

    VaultInvalidLiquidator: (),

    VaultEmptyPosition: (),

    VaultPositionSizeExceeded: (),
    VaultPositionCollateralExceeded: (),
}