// SPDX-License-Identifier: Apache-2.0
library;

pub struct SetOrderKeeper {
    pub account: Address,
    pub is_active: bool,
}

pub struct SetLiquidator {
    pub account: Address,
    pub is_active: bool,
}

pub struct SetPartner {
    pub account: Address,
    pub is_active: bool,
}

pub struct SetInLegacyMode {
    pub in_legacy_mode: bool,
}

pub struct SetShouldValidatorIncreaseOrder {
    pub should_validator_increase_order: bool,
}