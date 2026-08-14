"use client"

import { useMemo, useState } from "react"
import { Plus, Package } from "@phosphor-icons/react"
import { Badge, Button, Card, EmptyState, StatTile } from "@beautycrm/ui"
import type { InventoryItem, InventoryItemType, InventoryMovement } from "@/lib/inventory-types"
import { ItemFormSheet } from "./ItemFormSheet"
import { AdjustStockSheet } from "./AdjustStockSheet"

const UNIT_LABELS: Record<string, string> = { ml: "ml", gr: "gr", unit: "u." }

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function InventoryList({
  tenantId, branchId, items, movementsByItem, role,
}: {
  tenantId: string
  branchId: string
  items: InventoryItem[]
  /** Movimientos precargados por item_id, para el Sheet de ajuste. */
  movementsByItem: Record<string, InventoryMovement[]>
  role: string
}) {
  const [creating, setCreating] = useState<InventoryItemType | null>(null)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null)

  const canDelete = role === "owner"

  const supplies = useMemo(() => items.filter((i) => i.item_type === "supply"), [items])
  const products = useMemo(() => items.filter((i) => i.item_type === "product"), [items])
  const belowMinimum = useMemo(() => items.filter((i) => i.below_minimum).length, [items])

  function renderTable(rows: InventoryItem[], type: InventoryItemType) {
    return (
      <table>
        <thead>
          <tr>
            <th>{type === "supply" ? "Insumo" : "Producto"}</th>
            <th>{type === "supply" ? "Unidad" : "Precio"}</th>
            <th>Stock</th>
            <th>Mínimo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.item_id}>
              <td>
                <button type="button" className="link-button" onClick={() => setEditing(item)}>
                  {item.name}
                </button>
                {item.below_minimum ? (
                  <>
                    {" "}
                    <Badge tone="warning">Bajo</Badge>
                  </>
                ) : null}
              </td>
              <td>
                {type === "supply"
                  ? UNIT_LABELS[item.unit ?? "unit"]
                  : formatPrice(item.sale_price ?? 0)}
              </td>
              <td>{item.current_stock}</td>
              <td>{item.min_alert_level}</td>
              <td>
                <Button variant="secondary" onClick={() => setAdjusting(item)}>
                  Ajustar
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <StatTile label="Ítems bajo el mínimo" value={belowMinimum} />
      </div>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
          <h2>Insumos</h2>
          <Button onClick={() => setCreating("supply")}>
            <Plus size={16} weight="bold" /> Nuevo insumo
          </Button>
        </div>
        {supplies.length === 0 ? (
          <EmptyState
            icon={<Package size={24} weight="regular" />}
            title="Todavía no hay insumos"
            description="Cargá lo que usás en los servicios para poder controlar su stock."
          />
        ) : (
          renderTable(supplies, "supply")
        )}
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
          <h2>Productos de reventa</h2>
          <Button onClick={() => setCreating("product")}>
            <Plus size={16} weight="bold" /> Nuevo producto
          </Button>
        </div>
        {products.length === 0 ? (
          <EmptyState
            icon={<Package size={24} weight="regular" />}
            title="Todavía no hay productos"
            description="Cargá lo que vendés al público para poder controlar su stock."
          />
        ) : (
          renderTable(products, "product")
        )}
      </Card>

      {/* Montaje condicional con `key` en vez de dejar los Sheets siempre
          montados con `open` alternando: así cada entidad obtiene una
          instancia nueva y su estado nace ya sembrado, sin ventana de
          carrera. Ver el comentario en ItemFormSheet.tsx. */}
      {creating && (
        <ItemFormSheet
          key={`create-${creating}`}
          open
          onClose={() => setCreating(null)}
          tenantId={tenantId}
          itemType={creating}
        />
      )}
      {editing && (
        <ItemFormSheet
          key={editing.item_id}
          open
          onClose={() => setEditing(null)}
          tenantId={tenantId}
          itemType={editing.item_type}
          item={editing}
          canDelete={canDelete}
        />
      )}
      {adjusting && (
        <AdjustStockSheet
          key={`adjust-${adjusting.item_id}`}
          open
          onClose={() => setAdjusting(null)}
          branchId={branchId}
          item={adjusting}
          movements={movementsByItem[adjusting.item_id] ?? []}
        />
      )}
    </div>
  )
}
