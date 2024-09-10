// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    RLPAlreadyInitialized: (),
    RLPForbidden: (),
    RLPOnlyMinter: (),

    RLPMintToZeroAccount: (),
    RLPBurnFromZeroAccount: (),
    RLPTransferFromZeroAccount: (),
    RLPTransferToZeroAccount: (),
    RLPApproveFromZeroAccount: (),
    RLPApproveToZeroAccount: (),

    RLPInvalidBurnAssetForwarded: (),
    RLPInvalidBurnAmountForwarded: (),

    RLPInsufficientAllowance: (),
    RLPInsufficientBalance: (),
    RLPBurnAmountExceedsBalance: (),

    RLPInsufficientTransferAmountForwarded: ()
}