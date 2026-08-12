"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Trash } from "@phosphor-icons/react"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { createService, deleteService, updateService } from "@/lib/service-actions"
import type { ServiceInput, ServiceRecord } from "@/lib/service-types"

export function ServiceFormSheet({
  open,
  onClose,
  tenantId,
  mode,
  service,
  canDelete = false,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  mode: "create" | "edit"
  service?: ServiceRecord | null
  /** Solo el dueño puede borrar: services_delete es owner-only. */
  canDelete?: boolean
}) {
  const router = useRouter()
  // Duración y precio viven como string, no como number: si fueran number,
  // borrar el contenido del input daría NaN y el campo se volvería
  // imposible de vaciar mientras se tipea. Se parsean recién en el submit.
  const [name, setName] = useState("")
  const [durationMinutes, setDurationMinutes] = useState("60")
  const [price, setPrice] = useState("0")
  const [category, setCategory] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(service?.name ?? "")
    setDurationMinutes(String(service?.duration_minutes ?? 60))
    setPrice(String(service?.price ?? 0))
    setCategory(service?.category ?? "")
    setIsActive(service?.is_active ?? true)
    setError(null)
  }, [open, service])

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

    const input: ServiceInput = {
      name,
      durationMinutes: parsedDuration,
      price: parsedPrice,
      category: category.trim() || null,
      isActive,
    }

    setLoading(true)
    const result = mode === "create" ? await createService(tenantId, input) : await updateService(service!.id, input)
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  async function handleDelete() {
    if (!service) return
    if (!window.confirm(`¿Eliminar "${service.name}"? Esta acción no se puede deshacer.`)) return

    setError(null)
    setDeleting(true)
    const result = await deleteService(service.id)
    setDeleting(false)

    if (!result.ok) {
      // Se muestra en el banner del Sheet y NO se cierra, a diferencia del
      // window.alert de ClientDetailView: el error más probable acá es el de
      // FK ("ya fue usado en turnos"), cuya salida natural es destildar
      // "Activo" y guardar — es decir, quedarse en este mismo formulario.
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === "create" ? "Nuevo servicio" : "Editar servicio"} side="right">
      <form onSubmit={handleSubmit}>
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
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
        </Field>

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
