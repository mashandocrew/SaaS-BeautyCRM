"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PencilSimple, Trash, ClockCounterClockwise } from "@phosphor-icons/react"
import { Button, Card, EmptyState, StatTile } from "@beautycrm/ui"
import { deleteClient } from "@/lib/client-actions"
import type { ClientDetail } from "@/lib/client-types"
import { ClientFormSheet } from "../ClientFormSheet"
import { ClientHistoryTable } from "./ClientHistoryTable"

export function ClientDetailView({ tenantId, detail }: { tenantId: string; detail: ClientDetail }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { client, history, summary } = detail

  async function handleDelete() {
    if (!window.confirm(`¿Eliminar a ${client.full_name}? Esta acción no se puede deshacer.`)) return
    setDeleting(true)
    const result = await deleteClient(client.id)
    setDeleting(false)
    if (!result.ok) {
      window.alert(result.error)
      return
    }
    router.push("/dashboard/clientes")
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "var(--space-6)",
          gap: "var(--space-4)",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1>{client.full_name}</h1>
          <p style={{ color: "var(--color-ink-soft)" }}>
            {[client.phone, client.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
          </p>
          {client.birthday ? (
            <p style={{ color: "var(--color-ink-soft)" }}>
              Cumpleaños: {new Date(client.birthday).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}
            </p>
          ) : null}
          {client.notes ? <p>{client.notes}</p> : null}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            <PencilSimple size={16} weight="bold" /> Editar
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            <Trash size={16} weight="bold" /> {deleting ? "Eliminando..." : "Eliminar"}
          </Button>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <StatTile label="Visitas" value={summary.visitCount} />
        <StatTile
          label="Última visita"
          value={summary.lastVisitAt ? new Date(summary.lastVisitAt).toLocaleDateString("es-AR") : "—"}
        />
      </div>

      <Card>
        <h2>Historial</h2>
        {history.length === 0 ? (
          <EmptyState
            icon={<ClockCounterClockwise size={24} weight="regular" />}
            title="Sin historial todavía"
            description="Cuando se complete un turno de esta persona, va a aparecer acá."
          />
        ) : (
          <ClientHistoryTable history={history} />
        )}
      </Card>

      <ClientFormSheet open={editOpen} onClose={() => setEditOpen(false)} tenantId={tenantId} mode="edit" client={client} />
    </div>
  )
}
