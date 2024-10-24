# Ruscet Protocol Contracts

The contracts that power v1 of the Ruscet Protocol, the high-performance derivatives exchange built on the Fuel network with contracts written in the Sway language.

## Overview

Trading on Ruscet is supported by multi-asset pools that earns liquidity providers fees from market-making, swap fees, and leveraged trading.

The main components of the protocol are:

-- **Vault**
-- **RLP**
-- **Pricefeeds**

### 1. Vault

`Vault` comprises a modular design and consists of the following contracts:

-   `VaultStorage`       (contract storage)
-   `VaultUtils`         (contract storage + utility functions)
-   `Vault`/`VaultPool`  (all pooled assets stored here)
-   `VaultRusd`          (RUSD-specific logic)
-   `VaultPosition`      (position logic)
-   `VaultRouter`        (router logic)

The reasoning behind this decision, though unnecessarily complex, is to get around the Sway compiler restrictions on inlined code size and to allow for easier upgradability of the core logic.

### 2. RLP

`RLP` is the liquidity provider asset on the platform, and can be minted using any of the approved assets within the `Vault` pool such as `$ETH`, `$USDC`, and `$BTC`.

The price of RLP is pegged to the worth of all underlying assets within the `Vault`, factoring in profits and losses of all active positions.

### 3. Pricefeeds

`VaultPriceFeed` handles querying and updating of prices from the Pyth network for all assets within the `Vault` pool.


## Testing

```bash
pnpm i

pip install caer

# Build + Generate Types
pnpm build
pnpm gen:types

# --------- Testing ---------

### Run local Fuel Node
fuel-core run --snapshot ./chain-config --debug --db-type in-memory --graphql-max-complexity 200000000

### Ze tests
pnpm test
```

## Audits

Ruscet v1 has been thorougly audited by [Linum Labs](https://www.linumlabs.com/). The audit report can be found [here](https://github.com/burralabs/ruscet-contracts/tree/dev/audits).

# License

All code in this repository is protected under the Apache-2.0 License.
