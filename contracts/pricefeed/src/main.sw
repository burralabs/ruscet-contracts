// SPDX-License-Identifier: Apache-2.0
contract;

/*
 ____       _           __               _ 
|  _ \ _ __(_) ___ ___ / _| ___  ___  __| |
| |_) | '__| |/ __/ _ \ |_ / _ \/ _ \/ _` |
|  __/| |  | | (_|  __/  _|  __/  __/ (_| |
|_|   |_|  |_|\___\___|_|  \___|\___|\__,_|
*/

mod errors;

use std::{
    context::*,
    revert::require,
    storage::storage_string::*,
    string::String
};
use std::hash::*;
use helpers::{context::*, utils::*, zero::*};
use interfaces::pricefeed::Pricefeed;
use errors::*;

storage {
    is_initialized: bool = false,

    answer: u256 = 0,
    decimals: u8 = 8,
    round_id: u64 = 0,
    description: StorageString = StorageString {},
    gov: Account = ZERO_ACCOUNT,
    answers: StorageMap<u64, u256> = StorageMap::<u64, u256> {}
}

impl Pricefeed for Contract {
    #[storage(read, write)]
    fn initialize(
        gov: Account,
        description: String
    ) {
        require(
            !storage.is_initialized.read(),
            Error::PriceFeedAlreadyInitialized
        );
        require(gov.non_zero(), Error::PricefeedGovZero);

        storage.is_initialized.write(true);
        storage.gov.write(gov);
        storage.description.write_slice(description);
    }

    #[storage(read)]
    fn gov() -> Account {
        storage.gov.read()
    }

    #[storage(read)]
    fn latest_answer() -> u256 {
        storage.answer.read()
    }

    #[storage(read)]
    fn latest_round() -> u64 {
        storage.round_id.read()
    }

    #[storage(read)]
    fn get_latest_round() -> (u64, u256, u8) {
        (
            storage.round_id.read(),
            storage.answer.read(),
            storage.decimals.read()
        )
    }

    #[storage(read, write)]
    fn set_latest_answer(new_answer: u256) {
        // require(get_sender() == storage.gov.read(), Error::PricefeedForbidden);

        let round_id = storage.round_id.read();

        storage.round_id.write(round_id + 1);
        storage.answer.write(new_answer);
        storage.answers.insert(round_id + 1, new_answer);
    }

    #[storage(read)]
    fn get_round_data(round_id: u64) -> (u64, u256, u8) {
        require(
            round_id < storage.round_id.read(),
            Error::PricefeedRoundNotComplete
        );

        let answer = storage.answers.get(round_id).read();
        (
            round_id,
            answer,
            storage.decimals.read()
        )
    }
}