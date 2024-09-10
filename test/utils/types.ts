export type Address = {
    bits: string
}

export type ContractId = {
    bits: string
}

export type Account = {
    value: string
    is_contract: boolean
}

export type ContractAccount = {
    value: string
    is_contract: true
}

export type AddressAccount = {
    value: string
    is_contract: false
}

export type Identity = {
    ContractId?: { bits: string }
    Address?: { bits: string }
}

export type ContractIdentity = {
    ContractId?: { bits: string }
}

export type AddressIdentity = {
    Address?: { bits: string }
}
