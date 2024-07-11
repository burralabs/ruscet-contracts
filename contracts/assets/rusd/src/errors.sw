// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    YieldAssetAlreadyInitialized: (),
    YieldAssetForbidden: (),
    RUSDForbidden: (),
    YieldAssetAccountNotMarked: (),

    YieldAssetInvalidBurnAssetForwarded: (),
    YieldAssetInvalidBurnAmountForwarded: (),

    YieldAssetMintToZeroAccount: (),
    YieldAssetBurnFromZeroAccount: (),
    YieldAssetTransferFromZeroAccount: (),
    YieldAssetTransferToZeroAccount: (),
    YieldAssetApproveFromZeroAccount: (),
    YieldAssetApproveToZeroAccount: (),

    YieldAssetMsgSenderNotWhitelisted: (),
    YieldAssetInsufficientAllowance: (),
    YieldAssetInsufficientBalance: (),
    YieldAssetBurnAmountExceedsBalance: (),

    YieldAssetInsufficientTransferAmountForwarded: (),
}