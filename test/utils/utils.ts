import { AbstractAddress, FUEL_NETWORK_URL, Provider, WalletUnlocked } from "fuels"
import { FungibleAbi, UtilsAbi } from "../../types"
import { getAssetId, toAsset } from "./asset"
import { Contract } from "ethers"
import { toContract } from "./account"
import fs from "fs"
import path from "path"

const INDEXER_CONTRACT_DEPLOYMENTS = path.resolve(__dirname, "../indexer/indexer_deployments.json")

export async function deploy(contract: string, wallet: WalletUnlocked) {
    const bytecode = require(`../../types/${contract}Abi.hex`).default
    const factory = require(`../../types/factories/${contract}Abi__factory`)[`${contract}Abi__factory`]
    if (!factory) {
        throw new Error(`Could not find factory for contract ${contract}`)
    }
    return await factory.deployContract(bytecode, wallet)
}

export async function indexerDeploy(
    contract: string,
    wallet: WalletUnlocked,
    saveName: string | undefined = undefined,
    forceDeploy = false,
) {
    const bytecode = require(`../../types/${contract}Abi.hex`).default
    const factory = require(`../../types/factories/${contract}Abi__factory`)[`${contract}Abi__factory`]
    if (!factory) {
        throw new Error(`Could not find factory for contract ${contract}`)
    }

    const deployments = JSON.parse(fs.readFileSync(INDEXER_CONTRACT_DEPLOYMENTS).toString())
    if (deployments[saveName ?? contract] && !forceDeploy) {
        console.log(">>> Using existing deployment for", saveName ?? contract)
        return await factory.connect(deployments[saveName ?? contract], wallet)
    }

    const contr = await factory.deployContract(bytecode, wallet)

    deployments[saveName ?? contract] = contr.id.toB256()
    fs.writeFileSync(INDEXER_CONTRACT_DEPLOYMENTS, JSON.stringify(deployments, null, 4))

    return contr
}

export function formatComplexObject(obj: any, depth = 2) {
    if (Array.isArray(obj)) {
        const indent = " ".repeat(depth * 2)
        const elements = obj.map((item) => formatComplexObject(item, depth + 1)).join(`,\n${" ".repeat(depth * 2)}`)
        return `[\n${indent}${elements}\n${" ".repeat((depth - 1) * 2)}]`
    } else if (typeof obj === "object" && obj !== null) {
        // BN objects
        if (obj.constructor && obj.constructor.name === "BN") {
            return obj.toString() // JSON.stringify(obj)
        } else {
            const indent = " ".repeat(depth * 2)
            const entries = Object.entries(obj)
                .map(([key, value]) => `${indent}  ${key}: ${formatComplexObject(value, depth + 1)}`)
                .join(",\n")

            return `{\n${entries}\n${" ".repeat((depth - 1) * 2)}}`
        }
    } else {
        return JSON.stringify(obj)
    }
}

export async function getBalance(
    account: WalletUnlocked | { id: AbstractAddress },
    fungibleAsset: FungibleAbi | string,
    utils: UtilsAbi | undefined = undefined,
) {
    const localProvider = await Provider.create(FUEL_NETWORK_URL)

    if (account instanceof WalletUnlocked) {
        if (typeof fungibleAsset === "string") {
            return (await localProvider.getBalance(account.address, fungibleAsset)).toString()
        }
        return (await localProvider.getBalance(account.address, getAssetId(fungibleAsset))).toString()
    }

    if (!utils) {
        throw new Error("UtilsAbi reference not provided as fallback")
    }

    if (typeof fungibleAsset === "string") {
        return (await utils.functions.get_contr_balance(toContract(account), { bits: fungibleAsset }).call()).value.toString()
    }

    return (await utils.functions.get_contr_balance(toContract(account), toAsset(fungibleAsset)).call()).value.toString()
}

export async function getValue(call: any) {
    return (await call.call()).value
}

export async function getValStr(call: any) {
    return (await getValue(call)).toString()
}

export function formatObj(obj: any) {
    if (Array.isArray(obj)) {
        return obj.map((item) => formatObj(item))
    } else if (typeof obj === "object" && obj !== null) {
        // BN objects
        if (obj.constructor && ["BN", "BigNumber"].includes(obj.constructor.name)) {
            return obj.toString()
        } else {
            const newObj = {}
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    newObj[key] = formatObj(obj[key])
                }
            }
            return newObj
        }
    } else {
        return obj
    }
}
