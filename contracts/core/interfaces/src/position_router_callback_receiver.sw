// SPDX-License-Identifier: Apache-2.0
library;

abi PositionRouterCallbackReceiver {
    fn ruscet_position_callback(
        _position_key: b256,
        _is_executed: bool,
        _is_increase: bool
    );
}

impl PositionRouterCallbackReceiver for Contract {
    fn ruscet_position_callback(
        _position_key: b256,
        _is_executed: bool,
        _is_increase: bool
    ) {}
}