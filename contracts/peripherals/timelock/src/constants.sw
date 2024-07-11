// SPDX-License-Identifier: Apache-2.0
library;

pub const PRICE_PRECISION: u256 = 0xC9F2C9CD04674EDEA40000000u256; // 10 ** 30;
pub const BASIS_POINTS_DIVISOR: u64 = 10000;
pub const MAX_BUFFER: u64 = 5 * 3600 * 24; // 5 days
pub const MAX_FUNDING_RATE_FACTOR: u64 = 200; // 0.02%
pub const MAX_LEVERAGE_VALIDATION: u64 = 500000; // 50x