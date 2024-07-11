// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    RouterAlreadyInitialized: (),
    RouterForbidden: (),
    
    RouterInvalidAssetForwarded: (),
    RouterInvalidAssetAmount: (),
    RouterZeroAssetAmount: (),
    
    RouterInvalidPlugin: (),
    RouterPluginNotApproved: (),
}