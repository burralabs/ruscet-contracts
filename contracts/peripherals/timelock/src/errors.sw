// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    TimelockForbiddenNotGov: (),
    TimelockForbiddenNotAssetManager: (),
    TimelockForbiddenOnlyHandlerAndAbove: (),
    TimelockForbiddenOnlyKeeperAndAbove: (),

    TimelockInvalidBuffer: (),
    TimelockInvalidTarget: (),
    TimelockBufferCannotBeDecreased: (),
    TimelockInvalidMaxLeverage: (),
    TimelockInvalidFundingRateFactor: (),
    TimelockInvalidStableFundingRateFactor: (),
    TimelockInvalidMinProfitBps: (),
    TimelockInvalidCooldownDuration: (),

    TimelockInvalidAssetForwarded: (),
    TimelockInvalidAmountForwarded: (),

    TimelockAssetNotYetWhitelisted: (),
    TimelockLengthMismatch: (),
    TimelockInvalidRlpManager: (),

}