// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    PositionRouterAlreadyInitialized: (),
    PositionRouterForbidden: (),
    PositionRouterExpectedPositionKeeper: (),
    PositionRouterExpectedCallerToBeKeeper: (),
    PositionRouterExpectedCallerToBeAccount: (),

    PositionRouterInvalidFeeAssetForwarded: (),
    PositionRouterInvalidFeeForwarded: (),
    PositionRouterIncorrectCollateralAmountForwarded: (),
    PositionRouterZeroCollateralAmountForwarded: (),

    PositionRouterFeeTooLow: (),
    PositionRouterInvalidPathLen: (),

    PositionRouterDelay: (),
    PositionRouterExpired: (),
}