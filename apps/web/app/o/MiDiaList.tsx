"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Badge, Button } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaStatus } from "@/lib/agenda-types"
import { updateAppointmentStatus } from "@/lib/agenda-actions"
import { useAgendaRealtime } from "@/lib/useAgendaRealtime"
import { formatTime } from "@/lib/agenda-time"

const STATUS_LABEL: Record<AgendaStatus, string> = {
  booked: "Reservado",
  confirmed: "Confirmado",
  in_progress: "En curso",
  done: "Hecho",
  no_show: "No vino",
  cancelled: "Cancelado",
}

const NEXT_ACTION: Partial<Record<AgendaStatus, { status: AgendaStatus; label: string }>> = {
  booked: { status: "confirmed", label: "Confirmar" },
  confirmed: { status: "in_progress", label: "Iniciar" },
  in_progress: { status: "done", label: "Completar" },
}

export function MiDiaList({
  tenantId,
  initialAppointments,
}: {
  tenantId: string
  initialAppointments: AgendaAppointment[]
}) {
  const router = useRouter()
  const [appointments, setAppointments] = useState(initialAppointments)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  // El estado local es un espejo optimista de initialAppointments, pero
  // useState solo lee el inicializador en el primer mount: sin este efecto,
  // cada router.refresh() (disparado por useAgendaRealtime o al final de
  // changeStatus) traería un prop nuevo del servidor que quedaría descartado
  // en silencio, y la pantalla se desincronizaría de cambios hechos desde
  // otro lado (ej. el dueño editando el mismo turno desde /dashboard/agenda).
  useEffect(() => {
    setAppointments(initialAppointments)
  }, [initialAppointments])

  useAgendaRealtime(tenantId, () => router.refresh())

  async function changeStatus(appointment: AgendaAppointment, status: AgendaStatus) {
    setLoadingId(appointment.id)
    const previous = appointments
    setAppointments((prev) => prev.map((a) => (a.id === appointment.id ? { ...a, status } : a)))

    const result = await updateAppointmentStatus(appointment.id, status)

    setLoadingId(null)
    if (!result.ok) {
      setAppointments(previous)
      return
    }
    router.refresh()
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {appointments.map((a) => {
        const expanded = expandedId === a.id
        const next = NEXT_ACTION[a.status]
        const canMarkNoShow = a.status !== "done" && a.status !== "cancelled" && a.status !== "no_show"

        return (
          <div
            key={a.id}
            className="card card-interactive"
            onClick={() => setExpandedId(expanded ? null : a.id)}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{formatTime(a.starts_at)}</strong>
              <Badge tone={a.status === "done" ? "success" : "neutral"}>{STATUS_LABEL[a.status]}</Badge>
            </div>
            <p style={{ margin: "4px 0 0" }}>{a.client_name ?? "Cliente sin nombre"}</p>
            <p style={{ margin: 0, color: "var(--color-ink-soft)", fontSize: 13 }}>{a.client_phone ?? ""}</p>

            {expanded ? (
              <>
                <ul style={{ paddingLeft: 16, marginTop: 8 }}>
                  {a.services.map((s) => (
                    <li key={s.service_id}>
                      {s.name} · {s.duration_minutes} min
                    </li>
                  ))}
                </ul>
                <div className="agenda-status-actions" onClick={(e) => e.stopPropagation()}>
                  {next ? (
                    <Button disabled={loadingId === a.id} onClick={() => changeStatus(a, next.status)}>
                      {loadingId === a.id ? "Guardando..." : next.label}
                    </Button>
                  ) : null}
                  {canMarkNoShow ? (
                    <Button variant="secondary" disabled={loadingId === a.id} onClick={() => changeStatus(a, "no_show")}>
                      No asistió
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
