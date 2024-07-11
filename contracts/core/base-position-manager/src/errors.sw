// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    BPMAlreadyInitialized: (),
    BPMChildAlreadyRegistered: (),

    BPMVaultStorageZero: (),
    BPMRouterZero: (),
    BPMShortsTrackerZero: (),

    BPMInvalidPathLen: (),
    
    BPMForbidden: (),
    BPMOnlyChildContract: (),
    BPMIncorrectLength: (),
    BPMIncorrectPathLength: (),

    BPMMaxLongsExceeded: (),
    BPMMaxShortsExceeded: (),

    BPMMarkPriceGtPrice: (),
    BPMMarkPriceLtPrice: (),

    BPMInvalidAssetForwarded: (),
    BPMInvalidAssetAmountForwardedToCoverFeeAmount: (),
    
    BPMInvalidAmountOut: ()
}