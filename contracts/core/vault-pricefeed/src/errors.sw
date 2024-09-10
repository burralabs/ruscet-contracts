// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultPriceFeedAlreadyInitialized: (),
    VaultPriceFeedForbidden: (),

    VaultPriceFeedInvalidAdjustmentBps: (),
    VaultPriceFeedInvalidSpreadBasisPoints: (),
    VaultPriceFeedInvalidPriceSampleSpace: (),

    VaultPriceFeedInvalidPrice: (),
    VaultPriceFeedInvalidPriceFeed: (),
    VaultPriceFeedInvalidPriceFeedToUpdate: (),

    VaultPriceFeedInvalidPriceIEq0: (),
    VaultPriceFeedInvalidPriceINeq0: (),

    VaultPriceFeedCouldNotFetchPrice: (),
}