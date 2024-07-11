// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    PositionRouterAlreadyInitialized: (),
    PositionRouterForbidden: (),
    PositionRouterExpectedAccountToBeSender: (),

    PositionRouterLeverageNotEnabled: (),

    PositionRouterIncorrectCollateralAmountForwarded: (),
    PositionRouterZeroCollateralAmountForwarded: (),

    PositionRouterInvalidPathLen: (),
}