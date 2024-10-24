// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    VaultRusdForbiddenNotGov: (),
    VaultRusdForbiddenNotVaultRouter: (),
    VaultRouterAlreadyInitialized: (),

    VaultRouterReceiverCannotBeZero: (),

    VaultRouterAssetNotWhitelisted: (),
    VaultRouterInvalidAssetAmount: (),
    VaultRouterInvalidRusdAmount: (),
    VaultRouterInvalidRedemptionAmount: (),

    VaultRouterInvalidAssetForwarded: (),

    VaultRouterInvalidAmountOut: (),

    VaultRouterInvalidMintAmountGtU64Max: (),
    VaultRouterInvalidRUSDBurnAmountGtU64Max: (),

    VaultRouterPoolAmountLtBuffer: (),

    VaultRouterInvalidAmountIn: (),

    VaultRouterAssetInNotWhitelisted: (),
    VaultRouterAssetOutNotWhitelisted: (),
    VaultRouterAssetsAreEqual: (),
}