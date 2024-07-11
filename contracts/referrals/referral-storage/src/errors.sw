// SPDX-License-Identifier: Apache-2.0
library;

pub enum Error {
    ReferralStorageAlreadyInitialized: (),
    ReferralStorageForbiddenOnlyHandler: (),
    ReferralStorageForbiddenNotGov: (),

    ReferralStorageInvalidTotalRebate: (),
    ReferralStorageInvalidDiscountShare: (),
    ReferralStorageInvalidCode: (),
    ReferralStorageCodeAlreadyExists: (),

    ReferralStorageForbiddenNotCodeOwner: (),
}