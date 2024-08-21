// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultPriceFeedAlreadyInitialized: (),
    VaultPriceFeedForbidden: (),

    VaultPriceFeedInvalidPythPriceFeedId: (),

    VaultPriceFeedInvalidAdjustmentBps: (),
    VaultPriceFeedInvalidSpreadBasisPoints: (),
    VaultPriceFeedInvalidPriceSampleSpace: (),

    VaultPriceFeedInvalidPrice: (),
    VaultPriceFeedInvalidPriceFeed: (),

    VaultPriceFeedInvalidPriceIEq0: (),
    VaultPriceFeedInvalidPriceINeq0: (),

    VaultPriceFeedCouldNotFetchPrice: (),
}