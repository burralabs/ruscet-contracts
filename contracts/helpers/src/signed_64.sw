// SPDX-License-Identifier: Apache-2.0
library;

/*
    From: https://github.com/compolabs/sway-lend/blob/sway-v0.46/contracts/market/src/i64.sw
*/

pub struct Signed64 {
    pub value: u64,
    pub is_neg: bool,
}

impl From<u64> for Signed64 {
    fn from(value: u64) -> Self {
        Self {
            value, 
            is_neg: false
        }
    }

    // fn into(self) -> u64 {
    //     if !self.is_neg {
    //         self.value
    //     } else {
    //         require(false, "Signed64Error: cannot fit i64 into u64");
    //         revert(0);
    //     }
    // }
}

enum Error {
    Signed64AdditionOverflow: (),
    Signed64SubtractionOverflow: (),
    Signed64MultiplicationOverflow: (),
    Signed64DivisionOverflow: (),
}

impl core::ops::Eq for Signed64 {    
    fn eq(self, other: Self) -> bool {
        self.value == other.value && self.is_neg == other.is_neg
    }
}

impl core::ops::Ord for Signed64 {
    fn gt(self, other: Self) -> bool {
        if !self.is_neg && !other.is_neg {
            self.value > other.value
        } else if !self.is_neg && other.is_neg {
            true
        } else if self.is_neg && !other.is_neg {
            false
        } else if self.is_neg && other.is_neg {
            self.value < other.value
        } else {
            revert(0)
        }
    }

    fn lt(self, other: Self) -> bool {
        if !self.is_neg && !other.is_neg {
            self.value < other.value
        } else if !self.is_neg && other.is_neg {
            false
        } else if self.is_neg && !other.is_neg {
            true
        } else if self.is_neg && other.is_neg {
            self.value > other.value
        } else {
            revert(0)
        }
    }
}

impl Signed64 {
    /// Initializes a new, zeroed Signed64.
    pub fn new() -> Self {
        Self::from(0)
    }

    pub fn from_u64(value: u64, is_neg: bool) -> Self {
        Self {
            value, 
            is_neg
        }
    }

    pub fn ge(self, other: Self) -> bool {
        self > other || self == other
    }

    pub fn le(self, other: Self) -> bool {
        self < other || self == other
    }

    /// The size of this type in bits.
    pub fn bits() -> u32 {
        64
    }

    /// The largest value that can be represented by this integer type,
    pub fn max() -> Self {
        Self {
            value: u64::max(),
            is_neg: false,
        }
    }

    /// The smallest value that can be represented by this integer type.
    pub fn min() -> Self {
        Self {
            value: u64::min(),
            is_neg: true,
        }
    }

    /// Helper function to get a is_neg value of an unsigned number
    pub fn neg_from(value: u64) -> Self {
        Self {
            value,
            is_neg: if value == 0 { false } else { true },
        }
    }
}

impl core::ops::Add for Signed64 {
    /// Add a Signed64 to a Signed64. Panics on overflow.
    fn add(self, other: Self) -> Self {
        if !self.is_neg && !other.is_neg {
            Self::from(self.value + other.value)
        } else if self.is_neg && other.is_neg {
            Self::neg_from(self.value + other.value)
        } else if (self.value > other.value) {
            Self {
                is_neg: self.is_neg,
                value: self.value - other.value,
            }
        } else if (self.value < other.value) {
            Self {
                is_neg: other.is_neg,
                value: other.value - self.value,
            }
        } else if (self.value == other.value) {
            Self::new()
        } else {
            require(false, Error::Signed64AdditionOverflow);
            revert(0);
        }
    }
}

impl core::ops::Subtract for Signed64 {
    /// Subtract a Signed64 from a Signed64. Panics of overflow.
    fn subtract(self, other: Self) -> Self {
        if self == other { Self::new() }
        else if !self.is_neg && !other.is_neg && self.value > other.value {
            Self::from(self.value - other.value)
        } else if !self.is_neg && !other.is_neg && self.value < other.value  {
            Self::neg_from(other.value - self.value)
        } else if self.is_neg && other.is_neg && self.value > other.value {
            Self::neg_from(self.value - other.value)
        } else if self.is_neg && other.is_neg && self.value < other.value  {
            Self::from(other.value - self.value)
        } else if !self.is_neg && other.is_neg{
            Self::from(self.value + other.value)
        } else if self.is_neg && !other.is_neg {
            Self::neg_from(self.value + other.value)
        }  else {
            require(false, Error::Signed64SubtractionOverflow);
            revert(0);
        }
    }
}

impl core::ops::Multiply for Signed64 {
    /// Multiply a Signed64 with a Signed64. Panics of overflow.
    fn multiply(self, other: Self) -> Self {
        if self.value == 0 || other.value == 0{
            Self::new()
        } else if !self.is_neg == !other.is_neg {
            Self::from(self.value * other.value)
        } else if !self.is_neg != !other.is_neg{
            Self::neg_from(self.value * other.value)
        } else {
            require(false, Error::Signed64MultiplicationOverflow);
            revert(0);
        }
    }
}

impl core::ops::Divide for Signed64 {
    /// Divide a Signed64 by a Signed64. Panics if divisor is zero.
    fn divide(self, divisor: Self) -> Self {
        require(divisor != Self::new(), "ZeroDivisor");
        if self.value == 0{
            Self::new()    
        }else if !self.is_neg == !divisor.is_neg {
            Self::from(self.value / divisor.value)
        }else if !self.is_neg != !divisor.is_neg{
            Self::neg_from(self.value * divisor.value)
        } else {
            require(false, Error::Signed64DivisionOverflow);
            revert(0);
        }
    }
}

impl Signed64 {
    pub fn flip(self) -> Self {
        self * Self::neg_from(1)
    }
}