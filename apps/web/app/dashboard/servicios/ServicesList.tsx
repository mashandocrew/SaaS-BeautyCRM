"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Scissors } from "@phosphor-icons/react"
import { Badge, Button, Card, EmptyState } from "@beautycrm/ui"
import { toggleServiceActive } from "@/lib/service-actions"
import type { BomLine, ServiceRecord, SupplyOption } from "@/lib/service-types"
import { ServiceFormSheet } from "./ServiceFormSheet"

const SIN_CATEGORIA = "Sin categoría"

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function ServicesList({
  tenantId,
  services,
  role,
  supplyOptions,
  serviceBoms,
}: {
  tenantId: string
  services: ServiceRecord[]
  role: string
  supplyOptions: SupplyOption[]
  /** BOM de cada servicio, por id. Ver getServiceBoms en service-queries.ts. */
  serviceBoms: Record<string, BomLine[]>
}) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceRecord | null>(null)
  // id del servicio cuyo toggle está en vuelo, para deshabilitarlo y evitar
  // dobles clics mientras la server action responde.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canDelete = role === "owner"

  // getServices ya devuelve ordenado por category y luego name, así que
  // recorrer en orden y agrupar en un Map alcanza: las claves quedan en el
  // orden en que aparecen, y los null (que la query manda al final) caen
  // todos juntos en "Sin categoría".
  const groups = useMemo(() => {
    const map = new Map<string, ServiceRecord[]>()
    for (const service of services) {
      const key = service.category?.trim() || SIN_CATEGORIA
      const bucket = map.get(key)
      if (bucket) bucket.push(service)
      else map.set(key, [service])
    }
    return Array.from(map.entries())
  }, [services])

  async function handleToggle(service: ServiceRecord, nextActive: boolean) {
    setError(null)
    setPendingId(service.id)
    const result = await toggleServiceActive(service.id, nextActive)
    setPendingId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          marginBottom: "var(--space-4)",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} weight="bold" /> Nuevo servicio
        </Button>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {services.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Scissors size={24} weight="regular" />}
            title="Todavía no hay servicios"
            description="Cargá tu catálogo para poder elegir servicios al crear un turno en Agenda."
            action={<Button onClick={() => setCreateOpen(true)}>Agregar el primer servicio</Button>}
          />
        </Card>
      ) : (
        groups.map(([category, rows]) => (
          <Card key={category} style={{ marginBottom: "var(--space-4)" }}>
            <h2 style={{ marginBottom: "var(--space-3)" }}>{category}</h2>
            <table>
              <thead>
                <tr>
                  <th>Servicio</th>
                  <th>Duración</th>
                  <th>Precio</th>
                  <th>Activo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button type="button" className="link-button" onClick={() => setEditing(s)}>
                        {s.name}
                      </button>
                      {!s.is_active ? (
                        <>
                          {" "}
                          <Badge tone="neutral">Inactivo</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>{s.duration_minutes} min</td>
                    <td>{formatPrice(s.price)}</td>
                    <td>
                      <input
                        type="checkbox"
                        role="switch"
                        className="checkbox"
                        checked={s.is_active}
                        disabled={pendingId === s.id}
                        aria-label={`Servicio activo: ${s.name}`}
                        onChange={(e) => handleToggle(s, e.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}

      {/* Montaje condicional con `key` en vez de dejar el Sheet siempre
          montado con `open` alternando: así cada entidad (o el modo
          "create") obtiene una instancia nueva de ServiceFormSheet, y su
          estado nace ya sembrado desde `service` sin ventana de carrera —
          ver el comentario en ServiceFormSheet.tsx. */}
      {createOpen && (
        <ServiceFormSheet
          key="create"
          open
          onClose={() => setCreateOpen(false)}
          tenantId={tenantId}
          mode="create"
          supplyOptions={supplyOptions}
        />
      )}
      {editing && (
        <ServiceFormSheet
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          tenantId={tenantId}
          mode="edit"
          service={editing}
          canDelete={canDelete}
          supplyOptions={supplyOptions}
          initialBom={serviceBoms[editing.id] ?? []}
        />
      )}
    </div>
  )
}
