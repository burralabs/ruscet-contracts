// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultRouterForbiddenNotGov: (),
    VaultRouterAlreadyInitialized: (),
    VaultRouterInvalidMsgCaller: (),

    VaultRouterInvalidAssetForwarded: (),

    VaultRouterPoolAmountLtBuffer: (),

    VaultRouterInsufficientCollateralForFees: (),

    VaultRouterAccountCannotBeZero: (),

    VaultRouterCollateralShouldBeWithdrawn: (),
    VaultRouterSizeMustBeMoreThanCollateral: (),
    
    VaultRouterInvalidPosition: (),
    VaultRouterInvalidPositionSize: (),

    VaultRouterCollateralAssetNotWhitelisted: (),

    VaultRouterLongCollateralIndexAssetsMismatch: (),
    VaultRouterLongCollateralAssetMustNotBeStableAsset: (),

    VaultRouterShortCollateralAssetMustBeStableAsset: (),
    VaultRouterShortIndexAssetMustNotBeStableAsset: (),
    VaultRouterShortIndexAssetNotShortable: (),

    VaultPositionCannotBeLiquidated: (),

    VaultRouterInvalidLiquidator: (),

    VaultRouterEmptyPosition: (),

    VaultPositionSizeExceeded: (),
    VaultPositionCollateralExceeded: (),
}