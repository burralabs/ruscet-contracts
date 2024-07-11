// SPDX-License-Identifier: Apache-2.0
library;

use ::utils::ZERO_ASSET;

pub struct FixedVecAssetIdSize5 {
    len: u64,
    item0: AssetId,
    item1: AssetId,
    item2: AssetId,
    item3: AssetId,
    item4: AssetId,
}

impl FixedVecAssetIdSize5 {
    pub fn default() -> Self {
        FixedVecAssetIdSize5 {
            len: 0,
            item0: ZERO_ASSET,
            item1: ZERO_ASSET,
            item2: ZERO_ASSET,
            item3: ZERO_ASSET,
            item4: ZERO_ASSET,
        }
    }

    pub fn get(self, index: u64) -> AssetId {
        match index {
            0 => self.item0,
            1 => self.item1,
            2 => self.item2,
            3 => self.item3,
            4 => self.item4,
            _ => revert(0),
        }
    }

    pub fn len(self) -> u64 {
        self.len
    }

    pub fn push(ref mut self, item: AssetId) {
        match self.len {
            0 => self.item0 = item,
            1 => self.item1 = item,
            2 => self.item2 = item,
            3 => self.item3 = item,
            4 => self.item4 = item,
            _ => revert(0),
        }
        self.len += 1;
    }

    pub fn to_vec(self) -> Vec<AssetId> {
        let mut vec: Vec<AssetId> = Vec::new();

        match self.len {
            0 => {},
            1 => {
                vec.push(self.item0);
            },
            2 => {
                vec.push(self.item0);
                vec.push(self.item1);
            },
            3 => {
                vec.push(self.item0);
                vec.push(self.item1);
                vec.push(self.item2);
            },
            4 => {
                vec.push(self.item0);
                vec.push(self.item1);
                vec.push(self.item2);
                vec.push(self.item3);
            },
            5 => {
                vec.push(self.item0);
                vec.push(self.item1);
                vec.push(self.item2);
                vec.push(self.item3);
                vec.push(self.item4);
            },
            _ => revert(0),
        }

        vec
    }

    pub fn from_vec(vec: Vec<AssetId>) -> Self {
        let _len = vec.len();

        let (mut len, mut item0, mut item1, mut item2, mut item3, mut item4) = (
            0,
            ZERO_ASSET,
            ZERO_ASSET,
            ZERO_ASSET,
            ZERO_ASSET,
            ZERO_ASSET
        );

        match _len {
            0 => {},
            1 => {
                item0 = vec.get(0).unwrap();
                len = 1;
            },
            2 => {
                item0 = vec.get(0).unwrap();
                item1 = vec.get(1).unwrap();
                len = 2;
            },
            3 => {
                item0 = vec.get(0).unwrap();
                item1 = vec.get(1).unwrap();
                item2 = vec.get(2).unwrap();
                len = 3;
            },
            4 => {
                item0 = vec.get(0).unwrap();
                item1 = vec.get(1).unwrap();
                item2 = vec.get(2).unwrap();
                item3 = vec.get(3).unwrap();
                len = 4;
            },
            5 => {
                item0 = vec.get(0).unwrap();
                item1 = vec.get(1).unwrap();
                item2 = vec.get(2).unwrap();
                item3 = vec.get(3).unwrap();
                item4 = vec.get(4).unwrap();
                len = 5;
            },
            _ => revert(0),
        }

        FixedVecAssetIdSize5 {
            len,
            item0,
            item1,
            item2,
            item3,
            item4
        }
    }
}