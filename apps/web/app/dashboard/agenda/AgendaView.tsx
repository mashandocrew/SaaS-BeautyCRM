"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarBlank } from "@phosphor-icons/react"
import { EmptyState } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaOperator, AgendaService } from "@/lib/agenda-types"
import { AGENDA_DAY_END_HOUR, AGENDA_DAY_START_HOUR, addDays, formatDayLabel } from "@/lib/agenda-time"
import { useAgendaRealtime } from "@/lib/useAgendaRealtime"
import { AgendaGrid } from "./AgendaGrid"
import { NewAppointmentModal } from "./NewAppointmentModal"
import { AppointmentDetailPanel } from "./AppointmentDetailPanel"

const MOBILE_BREAKPOINT_QUERY = "(max-width: 1024px)"

export function AgendaView({
  tenantId,
  branchId,
  weekStartISO,
  initialAppointments,
  operators,
  services,
}: {
  tenantId: string
  branchId: string
  weekStartISO: string
  initialAppointments: AgendaAppointment[]
  operators: AgendaOperator[]
  services: AgendaService[]
}) {
  const router = useRouter()
  const weekStart = useMemo(() => new Date(weekStartISO), [weekStartISO])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const [selectedDay, setSelectedDay] = useState(() => new Date())
  const [modalSlot, setModalSlot] = useState<{ operatorId: string; startISO: string } | null>(null)
  // Guardamos solo el id y derivamos el turno de initialAppointments (igual
  // que dayAppointments más abajo) en vez de guardar una copia del objeto
  // en estado: si guardáramos el objeto, quedaría congelado con el status
  // viejo después de un changeStatus() que no cierra el panel (ej.
  // "confirmed"), porque el prop fresco que llega tras router.refresh()
  // nunca lo pisaría.
  const [detailAppointmentId, setDetailAppointmentId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileOperatorId, setMobileOperatorId] = useState(operators[0]?.id ?? "")

  useAgendaRealtime(tenantId, () => router.refresh())

  // Vista diaria en mobile/tablet: mismo componente AgendaGrid, pero con
  // una sola columna de operadora (elegida acá) en vez de columnas
  // paralelas — evita reinventar el layout para la pantalla chica.
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
    setIsMobile(mql.matches)
    function handleChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches)
    }
    mql.addEventListener("change", handleChange)
    return () => mql.removeEventListener("change", handleChange)
  }, [])

  const visibleOperators = useMemo(() => {
    if (!isMobile) return operators
    const selected = operators.find((o) => o.id === mobileOperatorId)
    return selected ? [selected] : operators.slice(0, 1)
  }, [isMobile, operators, mobileOperatorId])

  const dayAppointments = useMemo(() => {
    const dayStart = new Date(selectedDay)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = addDays(dayStart, 1)
    return initialAppointments.filter((a) => {
      const t = new Date(a.starts_at)
      return t >= dayStart && t < dayEnd
    })
  }, [initialAppointments, selectedDay])

  const detailAppointment = useMemo(
    () => initialAppointments.find((a) => a.id === detailAppointmentId) ?? null,
    [initialAppointments, detailAppointmentId]
  )

  // Turnos que la grilla no puede ubicar en ninguna columna/fila y por lo
  // tanto esconde en silencio: sin operadora asignada (bookAppointment
  // permite operatorId null para owner/supervisor) o con starts_at fuera
  // de la franja 08:00–21:00 que cubre buildDaySlots(). No resolvemos el
  // caso de fondo acá — solo dejamos de esconderlos sin avisar.
  const hiddenAppointmentsCount = useMemo(() => {
    return dayAppointments.filter((a) => {
      if (!a.operator_id) return true
      const startHour = new Date(a.starts_at).getHours()
      return startHour < AGENDA_DAY_START_HOUR || startHour >= AGENDA_DAY_END_HOUR
    }).length
  }, [dayAppointments])

  if (operators.length === 0) {
    return (
      <div>
        <h1>Agenda</h1>
        <div className="card">
          <EmptyState
            icon={<CalendarBlank size={24} weight="regular" />}
            title="Todavía no hay operadoras"
            description="Invitá a tu equipo desde Configuración para poder cargar turnos."
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1>Agenda</h1>

      <div className="agenda-day-tabs">
        {days.map((day) => (
          <button
            key={day.toISOString()}
            type="button"
            className="agenda-day-tab"
            data-active={day.toDateString() === selectedDay.toDateString()}
            onClick={() => setSelectedDay(day)}
          >
            {formatDayLabel(day)}
          </button>
        ))}
      </div>

      {isMobile && operators.length > 1 ? (
        <select
          className="input"
          style={{ marginBottom: "var(--space-4)" }}
          value={mobileOperatorId}
          onChange={(e) => setMobileOperatorId(e.target.value)}
          aria-label="Elegir operadora"
        >
          {operators.map((op) => (
            <option key={op.id} value={op.id}>
              {op.full_name ?? "Sin nombre"}
            </option>
          ))}
        </select>
      ) : null}

      {initialAppointments.length === 0 ? (
        <div className="card" style={{ marginBottom: "var(--space-4)" }}>
          <EmptyState
            icon={<CalendarBlank size={24} weight="regular" />}
            title="Todavía no hay turnos"
            description="Hacé click en un horario libre de la grilla para cargar el primero."
          />
        </div>
      ) : null}

      {hiddenAppointmentsCount > 0 ? (
        <p className="agenda-empty-hint">
          {hiddenAppointmentsCount} turno{hiddenAppointmentsCount === 1 ? "" : "s"} no se muestra
          {hiddenAppointmentsCount === 1 ? "" : "n"} en la grilla (sin operadora asignada o fuera del horario
          08:00–21:00).
        </p>
      ) : null}

      <AgendaGrid
        day={selectedDay}
        operators={visibleOperators}
        appointments={dayAppointments}
        onSlotClick={(operatorId, startISO) => setModalSlot({ operatorId, startISO })}
        onAppointmentClick={(appointment) => setDetailAppointmentId(appointment.id)}
      />

      {modalSlot ? (
        <NewAppointmentModal
          open={!!modalSlot}
          onClose={() => setModalSlot(null)}
          tenantId={tenantId}
          branchId={branchId}
          services={services}
          operators={operators}
          initialOperatorId={modalSlot.operatorId}
          initialStartISO={modalSlot.startISO}
          dayAppointments={dayAppointments}
        />
      ) : null}

      <AppointmentDetailPanel appointment={detailAppointment} onClose={() => setDetailAppointmentId(null)} />
    </div>
  )
}
