import type { Enums, Tables } from "@beautycrm/supabase/types"

export type PaymentMethod = Enums<"payment_method">
export type SaleItemType = Enums<"sale_item_type">

export type CashSession = Tables<"cash_sessions">

/** Un ítem vendible del catálogo, unificando servicios y productos. */
export type CatalogItem = {
  id: string
  type: SaleItemType
  name: string
  price: number
}

export type OperatorOption = {
  id: string
  name: string
}

/**
 * Lo que la UI manda al confirmar. Sin unit_price a propósito: el precio lo
 * resuelve el RPC (ver migrations/0013). Si viajara desde el browser,
 * cualquiera con la sesión abierta cobraría un servicio a $0.
 */
export type SaleLineInput = {
  item_id: string
  item_type: SaleItemType
  quantity: number
  operator_id: string | null
}

export type PaymentInput = {
  method: PaymentMethod
  amount: number
}

/** Una venta del turno, con lo necesario para listarla y anularla. */
export type SaleRecord = {
  id: string
  total: number
  discount: number
  created_at: string
  voided_at: string | null
  void_reason: string | null
  client_name: string | null
  items: { name: string; quantity: number; unit_price: number }[]
  payments: { method: PaymentMethod; amount: number }[]
}

/** Un turno listo para cobrar, con el precio que se le cotizó al cliente. */
export type AppointmentCharge = {
  appointment_id: string
  client_id: string | null
  client_name: string | null
  operator_id: string | null
  lines: SaleLineInput[]
  /** Sólo para mostrar: el que vale es el que resuelve el RPC. */
  preview: { name: string; price: number }[]
}
