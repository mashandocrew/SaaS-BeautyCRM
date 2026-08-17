export type Branch = {
  id: string
  name: string
  address: string | null
  phone: string | null
  is_active: boolean
}

export type BranchInput = {
  name: string
  address: string | null
  phone: string | null
}
