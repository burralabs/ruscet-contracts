# Ruscet Protocol Contracts

The contracts that power the Ruscet Protocol, the high-performance derivatives exchange built on the Fuel network with contracts written in the Sway language.

## Contracts in scope

Any contract that is not mentioned below is not in scope and used purely during tests

```bash
contracts/assets
    - time-distributor
    - yield-asset
    - yield-tracker
    - rusd
    - rlp

contracts/core
    - vault-pricefeed
    - vault-storage
    - vault-utils
    - vault

contracts/helpers
    - *

contracts/pricefeed
    - *
```

## Testing

```bash
# installs patches too
pnpm i

# For processing types
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

# License

All code in this repository is protected under the Apache-2.0 License.
