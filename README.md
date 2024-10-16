# Ruscet Protocol Contracts

The contracts that power v1 of the Ruscet Protocol, the high-performance derivatives exchange built on the Fuel network with contracts written in the Sway language.

## Audits

Ruscet v1 has been thorougly audited by [Linum Labs](https://www.linumlabs.com/). The audit report can be found [here](https://github.com/burralabs/ruscet-contracts/tree/dev/audits).

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

# License

All code in this repository is protected under the Apache-2.0 License.
