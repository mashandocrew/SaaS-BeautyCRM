import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { InventoryItem, InventoryItemType, InventoryMovement } from "./inventory-types"

/**
 * Todo el inventario del tenant: insumos y productos de reventa, cada uno
 * con su stock en cada sucursal. Los ítems eliminados no vienen — v_inventory
 * ya filtra deleted_at (ver migrations/0012).
 *
 * numeric de Postgres puede llegar como string aunque types.ts lo tipe
 * number — mismo Number() defensivo que ya hacen getServices y
 * getActiveServices.
 *
 * El cast final afirma el invariante que documenta InventoryItem: la vista
 * garantiza no-nulidad con sus coalesce, pero el generador de tipos no puede
 * verlo. Éste es el único lugar del módulo que debería hacer esa afirmación.
 */
export async function getInventory(tenantId: string): Promise<InventoryItem[]> {
  const supabase = await createClient()

  // El costo ya no viene en la vista: desde 0015 las columnas cost_per_unit
  // y cost están revocadas a nivel de GRANT, así que llegan sólo por
  // inventory_costs, que chequea que sea dueña o encargada.
  //
  // Las dos consultas van en paralelo: la de costos falla con 42501 para una
  // operadora, y en ese caso el inventario se devuelve sin costos en vez de
  // romper la página.
  const [inventory, costs] = await Promise.all([
    supabase.from("v_inventory").select("*").eq("tenant_id", tenantId).order("item_type").order("name"),
    supabase.rpc("inventory_costs", { p_tenant_id: tenantId }),
  ])

  const costByItem = new Map<string, number>()
  for (const c of costs.data ?? []) costByItem.set(c.item_id, Number(c.cost))

  return (inventory.data ?? []).map((row) => ({
    ...row,
    cost_per_unit: row.item_id === null ? null : (costByItem.get(row.item_id) ?? null),
    sale_price: row.sale_price === null ? null : Number(row.sale_price),
    current_stock: Number(row.current_stock),
    min_alert_level: Number(row.min_alert_level),
  })) as InventoryItem[]
}

/** Los últimos movimientos de un ítem en una sucursal, del más nuevo al más viejo. */
export async function getItemMovements(
  branchId: string,
  itemId: string,
  itemType: InventoryItemType,
): Promise<InventoryMovement[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("inventory_movements")
    .select("*")
    .eq("branch_id", branchId)
    .eq("item_id", itemId)
    .eq("item_type", itemType)
    .order("created_at", { ascending: false })
    .limit(10)

  return (data ?? []).map((m) => ({
    ...m,
    delta: Number(m.delta),
    resulting_stock: Number(m.resulting_stock),
  })) as InventoryMovement[]
}
