// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    PositionManagerAlreadyInitialized: (),
    PositionManagerForbidden: (),
    PositionManagerOnlyOrderKeeper: (),
    PositionManagerOnlyLiquidator: (),
    PositionManagerOnlyPartnerOrLegacyMode: (),

    PositionManagerOrderKeeperZero: (),
    PositionManagerLiquidatorZero: (),
    PositionManagerPartnerZero: (),

    PositionManagerInvalidPathLen: (),

    PositionManagerInvalidAssetForwarded: (),
    PositionManagerInvalidAssetAmount: (),
}