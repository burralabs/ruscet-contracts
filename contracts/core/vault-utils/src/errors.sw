// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultUtilsAlreadyInitialized: (),
    VaultForbiddenNotGov: (),
    VaultUtilsForbiddenNotAuthorizedCaller: (),

    VaultMaxRusdExceeded: (),
    VaultMaxShortsExceeded: (),
    VaultMaxLeverageExceeded: (),
    VaultPoolAmountExceeded: (),

    VaultReserveExceedsPool: (),
    VaultInvalidIncrease: (),
    VaultInsufficientReserve: (),

    VaultPriceQueriedIsZero: (),

    VaultInvalidPosition: (),
    VaultInvalidAveragePrice: (),
    VaultLossesExceedCollateral: (),
    VaultFeesExceedCollateral: (),
    VaultLiquidationFeesExceedCollateral: (),

    VaultDecimalsAreZero: (),
}