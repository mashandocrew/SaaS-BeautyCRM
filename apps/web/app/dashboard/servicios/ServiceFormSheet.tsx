"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash } from "@phosphor-icons/react"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { createService, deleteService, setServiceBom, updateService } from "@/lib/service-actions"
import type { BomLine, ServiceInput, ServiceRecord, SupplyOption } from "@/lib/service-types"

export function ServiceFormSheet({
  open,
  onClose,
  tenantId,
  mode,
  service,
  canDelete = false,
  supplyOptions,
  initialBom = [],
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  mode: "create" | "edit"
  service?: ServiceRecord | null
  /** Solo el dueño puede borrar: services_delete es owner-only. */
  canDelete?: boolean
  /** Insumos del tenant elegibles para el BOM. Ver getSupplyOptions. */
  supplyOptions: SupplyOption[]
  /** BOM ya cargado, para editar. Vacío en alta. */
  initialBom?: BomLine[]
}) {
  const router = useRouter()
  // Duración y precio viven como string, no como number: si fueran number,
  // borrar el contenido del input daría NaN y el campo se volvería
  // imposible de vaciar mientras se tipea. Se parsean recién en el submit.
  // Sembrado directamente desde `service` en los inicializadores de
  // useState, no con un useEffect: los efectos corren después del pintado,
  // así que había una ventana entre que el formulario se veía en pantalla y
  // que el efecto lo llenaba con los valores reales — cualquier valor que el
  // usuario tipeara en esa ventana se pisaba en silencio. El padre
  // (ServicesList) ahora monta este componente condicionalmente con una
  // `key` por entidad, así que un `service` distinto siempre implica una
  // instancia nueva, y sembrar en el inicializador alcanza.
  const [name, setName] = useState(service?.name ?? "")
  const [durationMinutes, setDurationMinutes] = useState(String(service?.duration_minutes ?? 60))
  const [price, setPrice] = useState(String(service?.price ?? 0))
  const [category, setCategory] = useState(service?.category ?? "")
  const [isActive, setIsActive] = useState(service?.is_active ?? true)
  // string y no number por el mismo motivo que duration/price arriba: un
  // input number vacío mientras se tipea no puede ser NaN.
  const [bomLines, setBomLines] = useState<{ supplyId: string; quantity: string }[]>(
    initialBom.map((l) => ({ supplyId: l.supply_id, quantity: String(l.quantity_consumed) })),
  )
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addBomLine() {
    const chosen = new Set(bomLines.map((l) => l.supplyId))
    const next = supplyOptions.find((s) => !chosen.has(s.id))
    if (!next) return
    setBomLines((lines) => [...lines, { supplyId: next.id, quantity: "1" }])
  }

  function updateBomLine(index: number, patch: Partial<{ supplyId: string; quantity: string }>) {
    setBomLines((lines) => lines.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function removeBomLine(index: number) {
    setBomLines((lines) => lines.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const parsedDuration = Number(durationMinutes)
    const parsedPrice = Number(price)

    if (!name.trim()) {
      setError("El nombre es obligatorio.")
      return
    }
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      setError("La duración tiene que ser mayor a 0 minutos.")
      return
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError("El precio no puede ser negativo.")
      return
    }

    const parsedBom: BomLine[] = []
    for (const line of bomLines) {
      const quantity = Number(line.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError("La cantidad de cada insumo tiene que ser mayor a 0.")
        return
      }
      parsedBom.push({ supply_id: line.supplyId, quantity_consumed: quantity })
    }

    const input: ServiceInput = {
      name,
      durationMinutes: parsedDuration,
      price: parsedPrice,
      category: category.trim() || null,
      isActive,
    }

    setLoading(true)
    const result = mode === "create" ? await createService(tenantId, input) : await updateService(service!.id, input)

    if (!result.ok) {
      setLoading(false)
      setError(result.error)
      return
    }

    // El servicio ya se guardó cuando esto falla: el error queda en el
    // banner, pero el Sheet no se cierra para que la persona pueda
    // reintentar guardar el BOM sin volver a llenar el resto del form.
    const bomResult = await setServiceBom(result.data.id, parsedBom)
    setLoading(false)
    if (!bomResult.ok) {
      setError(`El servicio se guardó, pero no pudimos guardar sus insumos: ${bomResult.error}`)
      return
    }

    onClose()
    router.refresh()
  }

  async function handleDelete() {
    if (!service) return
    if (
      !window.confirm(
        `¿Eliminar "${service.name}"? Va a desaparecer del catálogo y no se va a poder elegir en turnos nuevos. Los turnos y el historial que ya lo usaron quedan intactos.`,
      )
    )
      return

    setError(null)
    setDeleting(true)
    const result = await deleteService(service.id)
    setDeleting(false)

    if (!result.ok) {
      // Se muestra en el banner del Sheet y NO se cierra, a diferencia del
      // window.alert de ClientDetailView: los errores que quedan son de
      // permiso ("solo el dueño puede eliminar"), y cerrar el formulario
      // haría desaparecer la explicación junto con el botón que la provocó.
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === "create" ? "Nuevo servicio" : "Editar servicio"} side="right">
      {/* noValidate: la validación HTML5 de min/step bloqueaba el submit
          nativamente y en silencio (con min=1 step=5 el navegador solo
          acepta 1, 6, 11, 16… así que 45 y 60 minutos eran inválidos; con
          min=0 step=100, un precio de 12750 también). La validación real
          vive en handleSubmit, que además muestra el error en el banner
          del Sheet en vez de en un tooltip nativo. */}
      <form onSubmit={handleSubmit} noValidate>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Nombre" htmlFor="service-name">
          <Input id="service-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Duración (minutos)" htmlFor="service-duration">
          <Input
            id="service-duration"
            type="number"
            min={1}
            step={5}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            required
          />
        </Field>

        <Field label="Precio" htmlFor="service-price">
          <Input
            id="service-price"
            type="number"
            min={0}
            step={100}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </Field>

        <Field label="Categoría" htmlFor="service-category" hint="Opcional. Texto libre — por ejemplo: Cabello, Uñas.">
          <Input id="service-category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>

        <Field label="Activo" htmlFor="service-active">
          <input
            id="service-active"
            type="checkbox"
            className="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
        </Field>

        {/* Qué insumos consume el servicio y cuánto de cada uno. Cargando
            esto una vez, la venta descuenta stock sola en cada turno
            cobrado — sin esto no tiene sentido tener inventario si no se
            actualiza solo. Ver migrations/0015 (set_service_bom) y el Caja
            module, que dispara el descuento en cada venta. */}
        <hr style={{ margin: "var(--space-6) 0", border: 0, borderTop: "1px solid var(--color-border)" }} />
        <h3 style={{ marginBottom: "var(--space-2)" }}>Insumos que consume</h3>
        <p className="field-hint" style={{ marginBottom: "var(--space-3)" }}>
          Cada vez que se cobre este servicio, se descuenta esta cantidad del stock de cada insumo.
        </p>

        {supplyOptions.length === 0 ? (
          <p className="field-hint" style={{ marginBottom: "var(--space-3)" }}>
            Todavía no cargaste insumos en Inventario. Cargalos ahí para poder elegirlos acá.
          </p>
        ) : (
          bomLines.map((line, index) => {
            const chosenElsewhere = new Set(bomLines.filter((_, i) => i !== index).map((l) => l.supplyId))
            const availableForRow = supplyOptions.filter(
              (s) => s.id === line.supplyId || !chosenElsewhere.has(s.id),
            )
            const unit = supplyOptions.find((s) => s.id === line.supplyId)?.unit ?? ""

            return (
              <div
                key={index}
                style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end", marginBottom: "var(--space-3)" }}
              >
                <div style={{ flex: 2 }}>
                  <Field label="Insumo" htmlFor={`bom-supply-${index}`}>
                    <select
                      id={`bom-supply-${index}`}
                      className="input"
                      value={line.supplyId}
                      onChange={(e) => updateBomLine(index, { supplyId: e.target.value })}
                    >
                      {availableForRow.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label={`Cantidad${unit ? ` (${unit})` : ""}`} htmlFor={`bom-qty-${index}`}>
                    <Input
                      id={`bom-qty-${index}`}
                      type="number"
                      min={0}
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateBomLine(index, { quantity: e.target.value })}
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={`Quitar insumo ${supplyOptions.find((s) => s.id === line.supplyId)?.name ?? ""}`}
                  onClick={() => removeBomLine(index)}
                >
                  <Trash size={16} weight="bold" />
                </Button>
              </div>
            )
          })
        )}

        {supplyOptions.length > bomLines.length ? (
          <Button type="button" variant="secondary" onClick={addBomLine} style={{ marginBottom: "var(--space-4)" }}>
            <Plus size={16} weight="bold" /> Agregar insumo
          </Button>
        ) : null}

        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : mode === "create" ? "Crear servicio" : "Guardar cambios"}
        </Button>

        {mode === "edit" && canDelete ? (
          <>
            <hr style={{ margin: "var(--space-6) 0", border: 0, borderTop: "1px solid var(--color-border)" }} />
            <Button type="button" variant="danger" onClick={handleDelete} disabled={deleting}>
              <Trash size={16} weight="bold" /> {deleting ? "Eliminando..." : "Eliminar servicio"}
            </Button>
          </>
        ) : null}
      </form>
    </Sheet>
  )
}
