"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Trash } from "@phosphor-icons/react"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import {
  createProduct, createSupply, deleteInventoryItem, updateProduct, updateSupply,
} from "@/lib/inventory-actions"
import type { InventoryItem, InventoryItemType, SupplyUnit } from "@/lib/inventory-types"

const UNITS: { value: SupplyUnit; label: string }[] = [
  { value: "ml", label: "Mililitros (ml)" },
  { value: "gr", label: "Gramos (gr)" },
  { value: "unit", label: "Unidades" },
]

export function ItemFormSheet({
  open, onClose, tenantId, itemType, item, canDelete = false, canSeeCost,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  itemType: InventoryItemType
  /** null = alta. El padre monta este componente con `key` por ítem. */
  item?: InventoryItem | null
  canDelete?: boolean
  /** Owner-only desde 0017. Sin esto, ni se muestra ni se manda el costo. */
  canSeeCost: boolean
}) {
  const router = useRouter()
  // Sembrado en los inicializadores de useState, nunca con un useEffect:
  // los efectos corren después del pintado y vuelven a correr cuando cambia
  // la identidad de la prop, así que un árbol revalidado que aterrice con
  // el Sheet abierto pisaría lo que la persona está tipeando. El padre
  // monta este componente condicionalmente con `key`, así que un ítem
  // distinto siempre implica una instancia nueva. Ver commit 7173ee8.
  const [name, setName] = useState(item?.name ?? "")
  const [unit, setUnit] = useState<SupplyUnit>(item?.unit ?? "unit")
  const [costPerUnit, setCostPerUnit] = useState(String(item?.cost_per_unit ?? 0))
  const [salePrice, setSalePrice] = useState(String(item?.sale_price ?? 0))
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSupply = itemType === "supply"
  const isEdit = !!item

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const cost = canSeeCost ? Number(costPerUnit) : undefined
    const price = Number(salePrice)
    // Ternario sobre `item` y no sobre `isEdit`: TypeScript no propaga la
    // narrowing de un booleano derivado, así que con isEdit haría falta un
    // `item!` en cada rama. Preguntando por item directo, narrowea solo.
    const result = isSupply
      ? item
        ? await updateSupply(item.item_id, { name, unit, costPerUnit: cost })
        : await createSupply(tenantId, { name, unit, costPerUnit: cost })
      : item
        ? await updateProduct(item.item_id, { name, salePrice: price, cost })
        : await createProduct(tenantId, { name, salePrice: price, cost })

    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
    router.refresh()
  }

  async function handleDelete() {
    if (!item) return
    if (
      !window.confirm(
        `¿Eliminar "${item.name}"? Va a desaparecer del inventario. Los movimientos que ya registraste quedan intactos.`,
      )
    )
      return

    setError(null)
    setDeleting(true)
    const result = await deleteInventoryItem(item.item_id, itemType)
    setDeleting(false)
    if (!result.ok) {
      // Se muestra en el banner y no se cierra el Sheet: el error que queda
      // es de permiso, y cerrar haría desaparecer la explicación.
      setError(result.error)
      return
    }
    onClose()
    router.refresh()
  }

  const title = isEdit
    ? isSupply ? "Editar insumo" : "Editar producto"
    : isSupply ? "Nuevo insumo" : "Nuevo producto"

  return (
    <Sheet open={open} onClose={onClose} title={title} side="right">
      {/* noValidate: la validación HTML5 de min/step bloquea el submit
          nativamente y en silencio para valores válidos. La validación real
          vive en la server action y se muestra en este banner. Ver 26388bd. */}
      <form onSubmit={handleSubmit} noValidate>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Nombre" htmlFor="item-name">
          <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        {isSupply ? (
          <Field label="Unidad" htmlFor="item-unit">
            <select
              id="item-unit"
              className="input"
              value={unit}
              onChange={(e) => setUnit(e.target.value as SupplyUnit)}
            >
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Precio de venta" htmlFor="item-sale-price">
            <Input
              id="item-sale-price"
              type="number"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              required
            />
          </Field>
        )}

        {/* Owner-only (0017): la encargada no ve ni edita el costo. Si crea
            un ítem, nace en 0 y la dueña lo completa después. */}
        {canSeeCost ? (
          <Field
            label={isSupply ? "Costo por unidad" : "Costo"}
            htmlFor="item-cost"
            hint={isSupply ? "Lo que te cuesta cada ml, gr o unidad." : "Lo que te cuesta comprarlo."}
          >
            <Input
              id="item-cost"
              type="number"
              value={costPerUnit}
              onChange={(e) => setCostPerUnit(e.target.value)}
              required
            />
          </Field>
        ) : null}

        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : isEdit ? "Guardar cambios" : isSupply ? "Crear insumo" : "Crear producto"}
        </Button>

        {isEdit && canDelete ? (
          <>
            {" "}
            <Button type="button" variant="danger" onClick={handleDelete} disabled={deleting}>
              <Trash size={16} weight="bold" /> {deleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </>
        ) : null}
      </form>
    </Sheet>
  )
}
