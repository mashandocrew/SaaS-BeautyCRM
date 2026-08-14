import type { Enums, Tables } from "@beautycrm/supabase/types"

export type InventoryItemType = Enums<"inventory_item_type">
export type SupplyUnit = Enums<"supply_unit">

/**
 * Una fila de v_inventory: el ítem con su stock en una sucursal.
 *
 * No es `Tables<"v_inventory">` a secas. El generador de Supabase marca TODA
 * columna de una vista como nullable porque no puede probar lo contrario a
 * través del plan de la query — pero la vista sí garantiza estas columnas:
 * los `coalesce(..., 0)` de current_stock y min_alert_level, el `> 0 and <=`
 * de below_minimum, y los campos que vienen de columnas `not null` de
 * supplies/retail_products/branches (ver migrations/0012).
 *
 * Sólo `unit`, `cost_per_unit` y `sale_price` son honestamente nullables: la
 * vista los completa con `null::` en la rama que no corresponde — un insumo
 * no tiene precio de venta, un producto de reventa no tiene unidad.
 *
 * getInventory es quien afirma este invariante (hace el cast), y es el único
 * lugar que debería hacerlo.
 */
export type InventoryItem = {
  tenant_id: string
  branch_id: string
  branch_name: string
  item_id: string
  item_type: InventoryItemType
  name: string
  unit: SupplyUnit | null
  cost_per_unit: number | null
  sale_price: number | null
  current_stock: number
  min_alert_level: number
  below_minimum: boolean
}

/** La forma cruda que devuelve el cliente de Supabase, antes de normalizar. */
export type InventoryRow = Tables<"v_inventory">

export type InventoryMovement = Tables<"inventory_movements">

/**
 * Forma que consume el form. camelCase y sin `tenant_id` a propósito: el
 * tenant lo pone la server action desde la sesión, nunca el cliente —
 * mismo criterio que ServiceInput en lib/service-types.ts.
 */
export type SupplyInput = {
  name: string
  unit: SupplyUnit
  costPerUnit: number
}

export type ProductInput = {
  name: string
  salePrice: number
  cost: number
}

/**
 * Los cuatro movimientos que ofrece la UI. No incluye 'venta': eso lo
 * escribe el módulo Caja desde el trigger, no una persona desde un form.
 *
 * 'recuento' es el raro: `amount` es la cantidad CONTADA (absoluta), no un
 * delta. La resta la hace record_stock_count adentro de la transacción.
 */
export type AdjustmentKind = "compra" | "rotura" | "recuento" | "ajuste"
