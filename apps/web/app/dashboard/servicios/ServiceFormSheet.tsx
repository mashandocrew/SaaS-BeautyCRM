"use client"

import { useState, type FormEvent } from "react"
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
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
