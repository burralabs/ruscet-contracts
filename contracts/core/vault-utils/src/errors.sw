// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultUtilsAlreadyInitialized: (),
    VaultUtilsForbiddenNotGov: (),
    VaultUtilsForbiddenNotAuthorizedCaller: (),

    VaultUtilsMaxRusdExceeded: (),
    VaultUtilsMaxShortsExceeded: (),
    VaultUtilsMaxLeverageExceeded: (),
    VaultUtilsPoolAmountExceeded: (),

    VaultUtilsReserveExceedsPool: (),
    VaultUtilsInvalidIncrease: (),
    VaultUtilsInsufficientReserve: (),

    VaultUtilsInvalidAveragePrice: (),
    VaultUtilsLossesExceedCollateral: (),
    VaultUtilsFeesExceedCollateral: (),
    VaultUtilsLiquidationFeesExceedCollateral: (),

    VaultUtilsInvalidFundingRateFactor: (),
    VaultUtilsInvalidStableFundingRateFactor: (),
}