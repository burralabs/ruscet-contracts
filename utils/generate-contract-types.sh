#!/bin/bash

# Generate contract types
yarn fuels typegen -i $(find ./contracts -name '*-abi.json' | grep -v '/scripts') -o ./types