// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    RSCTAlreadyInitialized: (),
    RSCTForbidden: (),
    RSCTOnlyMinter: (),

    RSCTMintToZeroAccount: (),
    RSCTBurnFromZeroAccount: (),
    RSCTTransferFromZeroAccount: (),
    RSCTTransferToZeroAccount: (),
    RSCTApproveFromZeroAccount: (),
    RSCTApproveToZeroAccount: (),

    RSCTInvalidBurnAssetForwarded: (),
    RSCTInvalidBurnAmountForwarded: (),

    RSCTInsufficientAllowance: (),
    RSCTInsufficientBalance: (),
    RSCTBurnAmountExceedsBalance: (),

    RSCTInsufficientTransferAmountForwarded: ()
}