#!/bin/bash

# Generate contract types
yarn fuels typegen -i $(find ./scripts -name '*-abi.json' | grep '/scripts') -o ./types/scripts --script
yarn p