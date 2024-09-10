import {
    Account,
    Address,
    AddressAccount,
    AddressIdentity,
    ContractAccount,
    ContractId,
    ContractIdentity,
    Identity,
} from "./types"

export function addrToAccount(addr: any): AddressAccount {
    return toAccount(addr, false) as any
}

export function contrToAccount(addr: any): ContractAccount {
    return toAccount(addr, true) as any
}

export function toAccount(addr: any, is_contract: boolean): Account {
    if (addr["toB256"]) return { value: addr.toB256(), is_contract }
    if (addr["toHexString"]) return { value: addr.toHexString(), is_contract }
    if (addr["address"]) return { value: addr.address.toHexString(), is_contract }
    if (addr["id"]) return { value: addr.id.toHexString(), is_contract }

    return { value: addr, is_contract }
}

export function addrToIdentity(addr: any): AddressIdentity {
    return toIdentity(addr, false) as any
}

export function contrToIdentity(addr: any): ContractIdentity {
    return toIdentity(addr, true) as any
}

export function toIdentity(addr: any, is_contract: boolean): Identity {
    if (is_contract) {
        return { ContractId: toContract(addr) }
    }

    return { Address: toAddress(addr) }
}

export function toAddress(value: any): Address {
    return { bits: toAccount(value, false).value }
}

export function toContract(value: any): ContractId {
    return { bits: toAccount(value, true).value }
}
