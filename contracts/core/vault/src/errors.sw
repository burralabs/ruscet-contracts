// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultForbiddenNotGov: (),
    VaultAlreadyInitialized: (),
    VaultForbiddenNotManager: (),
    VaultInvalidMsgCaller: (),

    VaultReceiverCannotBeZero: (),

    VaultAssetNotWhitelisted: (),
    VaultInvalidAssetAmount: (),
    VaultInvalidRusdAmount: (),
    VaultInvalidRedemptionAmount: (),
    VaultZeroAmountOfAssetForwarded: (),

    VaultInvalidAmountOut: (),

    VaultInvalidMintAmountGtU64Max: (),
    VaultInvalidRUSDBurnAmountGtU64Max: (),

    VaultSwapsNotEnabled: (),

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

    VaultLeverageNotEnabled: (),

    VaultLongCollateralIndexAssetsMismatch: (),
    VaultLongCollateralAssetNotWhitelisted: (),
    VaultLongCollateralAssetMustNotBeStableAsset: (),

    VaultShortCollateralAssetNotWhitelisted: (),
    VaultShortCollateralAssetMustBeStableAsset: (),
    VaultShortIndexAssetMustNotBeStableAsset: (),
    VaultShortIndexAssetNotShortable: (),

    VaultPositionCannotBeLiquidated: (),

    VaultInvalidLiquidator: (),

    VaultEmptyPosition: (),

    VaultPositionSizeExceeded: (),
    VaultPositionCollateralExceeded: (),
}