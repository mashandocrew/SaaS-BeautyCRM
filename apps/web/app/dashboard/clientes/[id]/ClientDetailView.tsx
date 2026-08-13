"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PencilSimple, Trash, ClockCounterClockwise } from "@phosphor-icons/react"
import { Button, Card, EmptyState, StatTile } from "@beautycrm/ui"
import { deleteClient } from "@/lib/client-actions"
import type { ClientDetail } from "@/lib/client-types"
import { ClientFormSheet } from "../ClientFormSheet"
import { ClientHistoryTable } from "./ClientHistoryTable"

// client.birthday es un `date` de Postgres: llega como "YYYY-MM-DD" puro,
// sin hora ni zona. `new Date("1990-05-12")` lo parsea como medianoche UTC,
// y formatear eso con toLocaleDateString sin timeZone explícito usa la zona
// del entorno donde corre — server (UTC) vs browser (America/Argentina,
// UTC-3) pueden mostrar días distintos para el mismo string, y como este es
// un Client Component que también renderiza en SSR, eso es un mismatch de
// hidratación real, no solo un detalle visual. Parseamos los 3 componentes
// a mano y forzamos timeZone: "UTC" en el formateo para que el resultado
// sea determinístico sin importar dónde se ejecute.
function formatBirthday(birthday: string): string {
  const [year, month, day] = birthday.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "UTC" })
}

// summary.lastVisitAt viene de performed_at (timestamptz): a diferencia de
// birthday sí trae una zona real, pero toLocaleDateString sin timeZone
// explícito igual queda a merced de la zona del entorno (server vs
// browser) → mismo riesgo de hidratación. Fijamos "America/Argentina/
// Mendoza" (mismo TZ que next.config.js pinea para todo el proceso) en vez
// de "UTC": performed_at es un instante real, no un date-only como
// birthday, y un turno que termina entre las 21:00 y las 23:59 locales cae
// en el día siguiente en UTC — mostrar la fecha en UTC sería tan
// incorrecto como no fijar ninguna zona.
function formatVisitDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Mendoza" })
}

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
              Cumpleaños: {formatBirthday(client.birthday)}
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
          value={summary.lastVisitAt ? formatVisitDate(summary.lastVisitAt) : "—"}
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

      {/* Montaje condicional con `key` por cliente — ver el comentario en
          ClientFormSheet.tsx sobre por qué esto elimina la ventana de
          carrera entre el pintado y la siembra del estado. */}
      {editOpen && (
        <ClientFormSheet key={client.id} open onClose={() => setEditOpen(false)} tenantId={tenantId} mode="edit" client={client} />
      )}
    </div>
  )
}
