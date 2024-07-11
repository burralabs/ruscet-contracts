// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    OrderBookAlreadyInitialized: (),
    OrderBookForbidden: (),
    OrderBookVaultZero: (),
    OrderBookRouterZero: (),
    OrderBookRusdZero: (),

    OrderBookInvalidAssetForwarded: (),
    OrderBookIncorrectAssetAmountForwarded: (),
    OrderBookInsufficientExecutionFee: (),
    OrderBookIncorrectValueTransferred: (),
    OrderBookIncorrectExecutionFeeTransferred: (),
    OrderBookPath0ShouldBeETH: (),

    OrderBookInvalidPath: (),
    OrderBookInvalidPathLen: (),
    OrderBookInvalidMsgAsset: (),
    OrderBookInvalidMsgAmount: (),

    OrderBookInsufficientCollateral: (),
    OrderBookOrderDoesntExist: (),

    OrderBookInvalidPriceForExecution: (),

    OrderBookInsufficientAmountOut: (),
}