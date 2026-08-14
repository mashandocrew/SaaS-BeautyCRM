import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getInventory, getItemMovements } from "@/lib/inventory-queries"
import type { InventoryMovement } from "@/lib/inventory-types"
import { InventoryList } from "./InventoryList"

export default async function InventarioPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  // Sin selector de sucursal: el tenant es mode='single' y el doc de
  // arquitectura (A.3) pide ocultarlo con auto-selección.
  const branchId = membership.branch_id
  if (!branchId) redirect("/dashboard")

  const items = await getInventory(membership.tenant_id)

  // Los movimientos se precargan acá y no dentro del Sheet: el Sheet es un
  // Client Component y no puede hacer queries server-only. A esta escala
  // (decenas de ítems) es una consulta por ítem contra un índice.
  const movementsByItem: Record<string, InventoryMovement[]> = {}
  await Promise.all(
    items.map(async (item) => {
      movementsByItem[item.item_id] = await getItemMovements(branchId, item.item_id, item.item_type)
    }),
  )

  return (
    <div>
      <h1>Inventario</h1>
      {/* role viaja hasta el Sheet para decidir si se muestra "Eliminar":
          el borrado es owner-only. El layout de /dashboard ya sacó a las
          operadoras, así que acá role es owner o supervisor. */}
      <InventoryList
        tenantId={membership.tenant_id}
        branchId={branchId}
        items={items}
        movementsByItem={movementsByItem}
        role={membership.role}
      />
    </div>
  )
}
