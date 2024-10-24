// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    YieldAssetAlreadyInitialized: (),
    YieldAssetForbidden: (),
    YieldAssetAccountNotMarked: (),

    YieldAssetMintToZeroAccount: (),
    YieldAssetBurnFromZeroAccount: (),
    YieldAssetTransferFromZeroAccount: (),
    YieldAssetTransferToZeroAccount: (),

    YieldAssetInvalidSignature: (),

    YieldAssetMsgSenderNotWhitelisted: (),
    YieldAssetInsufficientAllowance: (),
    YieldAssetInsufficientBalance: (),
    YieldAssetBurnAmountExceedsBalance: (),

    YieldAssetInsufficientTransferAmountForwarded: ()
}