"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge, Button, Sheet } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaStatus } from "@/lib/agenda-types"
import { updateAppointmentStatus } from "@/lib/agenda-actions"
import { formatTime } from "@/lib/agenda-time"

const NEXT_STATUS: Partial<Record<AgendaStatus, { status: AgendaStatus; label: string }>> = {
  booked: { status: "confirmed", label: "Confirmar" },
  confirmed: { status: "in_progress", label: "Iniciar" },
  in_progress: { status: "done", label: "Completar" },
}

export function AppointmentDetailPanel({
  appointment,
  onClose,
}: {
  appointment: AgendaAppointment | null
  onClose: () => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<AgendaStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!appointment) return null

  const appointmentId = appointment.id

  async function changeStatus(status: AgendaStatus) {
    setLoading(status)
    setError(null)
    const result = await updateAppointmentStatus(appointmentId, status)
    setLoading(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
    if (status === "done" || status === "cancelled" || status === "no_show") {
      onClose()
    }
  }

  const next = NEXT_STATUS[appointment.status]
  const canCancel = appointment.status !== "done" && appointment.status !== "cancelled"

  return (
    <Sheet open={!!appointment} onClose={onClose} title="Detalle del turno" side="right">
      {error ? <p className="error-banner">{error}</p> : null}

      <p className="agenda-detail-time">
        {formatTime(appointment.starts_at)} – {formatTime(appointment.ends_at)}
      </p>
      <Badge tone="neutral">{appointment.status}</Badge>

      <h3 style={{ marginTop: "var(--space-4)" }}>{appointment.client_name ?? "Sin cliente"}</h3>
      {appointment.client_phone ? <p>{appointment.client_phone}</p> : null}
      <p style={{ color: "var(--color-ink-soft)" }}>{appointment.operator_name ?? "Sin operadora"}</p>

      <ul style={{ paddingLeft: 16 }}>
        {appointment.services.map((s) => (
          <li key={s.service_id}>
            {s.name} · {s.duration_minutes} min · ${s.price_snapshot}
          </li>
        ))}
      </ul>
      <p>
        <strong>Total: ${appointment.total_price}</strong>
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
        {next ? (
          <Button disabled={loading !== null} onClick={() => changeStatus(next.status)}>
            {loading === next.status ? "Guardando..." : next.label}
          </Button>
        ) : null}
        {canCancel ? (
          <>
            <Button variant="secondary" disabled={loading !== null} onClick={() => changeStatus("no_show")}>
              No asistió
            </Button>
            <Button variant="danger" disabled={loading !== null} onClick={() => changeStatus("cancelled")}>
              Cancelar turno
            </Button>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}
