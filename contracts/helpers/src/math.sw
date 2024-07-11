// SPDX-License-Identifier: Apache-2.0
library;

use std::revert::require;

/*
    From: https://github.com/FuelLabs/sway/blob/694457da6a507ecee047c1ef8a5865ef4cc07147/sway-lib-core/src/ops.sw#L25

    Note: `add` is already implemented in the stdlib, so skipping
*/

enum Error {
    MathMulIntegerOverflow: ()
}

impl u256 {
    pub fn sub(self, other: Self) -> Self {
        __sub(self, other)
    }
}

impl u64 {
    pub fn sub(self, other: Self) -> Self {
        __sub(self, other)
    }
}

// unlike addition, underflowing subtraction does not need special treatment
// because VM handles underflow
impl u32 {
    pub fn sub(self, other: Self) -> Self {
        __sub(self, other)
    }
}

impl u16 {
    pub fn sub(self, other: Self) -> Self {
        __sub(self, other)
    }
}

impl u8 {
    pub fn sub(self, other: Self) -> Self {
        __sub(self, other)
    }
}


impl u256 {
    pub fn mul(self, other: Self) -> Self {
        __mul(self, other)
    }
}

impl u64 {
    pub fn mul(self, other: Self) -> Self {
        __mul(self, other)
    }
}

// Emulate overflowing arithmetic for non-64-bit integer types
impl u32 {
    pub fn mul(self, other: Self) -> Self {
        // any non-64-bit value is compiled to a u64 value under-the-hood
        // constants (like Self::max() below) are also automatically promoted to u64
        let res = __mul(self, other);
        if __gt(res, Self::max()) {
            // integer overflow
            require(false, Error::MathMulIntegerOverflow);
            // unreachable, but compiler complains so...
            0
        } else {
            // no overflow
            res
        }
    }
}

impl u16 {
    pub fn mul(self, other: Self) -> Self {
        let res = __mul(self, other);
        if __gt(res, Self::max()) {
            require(false, Error::MathMulIntegerOverflow);
            // unreachable, but compiler complains so...
            0
        } else {
            res
        }
    }
}

impl u8 {
    pub fn mul(self, other: Self) -> Self {
        let self_u64 = asm(input: self) {
            input: u64
        };
        let other_u64 = asm(input: other) {
            input: u64
        };
        let res_u64 = __mul(self_u64, other_u64);
        let max_u8_u64 = asm(input: Self::max()) {
            input: u64
        };
        if __gt(res_u64, max_u8_u64) {
            require(false, Error::MathMulIntegerOverflow);
            // unreachable, but compiler complains so...
            0
        } else {
            asm(input: res_u64) {
                input: u8
            }
        }
    }
}

impl u256 {
    pub fn div(self, other: Self) -> Self {
        __div(self, other)
    }
}

impl u64 {
    pub fn div(self, other: Self) -> Self {
        __div(self, other)
    }
}

// division for unsigned integers cannot overflow,
// but if signed integers are ever introduced,
// overflow needs to be handled, since
// Self::max() / -1 overflows
impl u32 {
    pub fn div(self, other: Self) -> Self {
        __div(self, other)
    }
}

impl u16 {
    pub fn div(self, other: Self) -> Self {
        __div(self, other)
    }
}

impl u8 {
    pub fn div(self, other: Self) -> Self {
        __div(self, other)
    }
}