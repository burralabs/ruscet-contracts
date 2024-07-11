// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    RLPManagerAlreadyInitialized: (),
    RLPManagerForbidden: (),
    RLPManagerOnlyHandler: (),

    RLPManagerHandlerZero: (),

    RLPManagerInvalidCooldownDuration: (),
    RLPManagerForbiddenInPrivateMode: (),

    RLPManagerInvalidWeight: (),

    RLPManagerInvalidAmount: (),
    RLPManagerInvalidAssetForwarded: (),
    RLPManagerInvalidAssetAmountForwarded: (),
    RLPManagerInsufficientRUSDOutput: (),
    RLPManagerInsufficientRLPOutput: (),

    RLPManagerCooldownDurationNotYetPassed: (),
    RLPManagerInvalidRlpAmount: (),
    RLPManagerInsufficientOutput: (),
}