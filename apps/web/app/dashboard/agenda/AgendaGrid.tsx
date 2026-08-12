"use client"

import { useMemo } from "react"
import { Badge } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaOperator } from "@/lib/agenda-types"
import { buildDaySlots, formatTime, slotIndexForTime, slotSpanForRange } from "@/lib/agenda-time"
import { STATUS_LABEL, STATUS_TONE } from "@/lib/agenda-status"

export function AgendaGrid({
  day,
  operators,
  appointments,
  onSlotClick,
  onAppointmentClick,
}: {
  day: Date
  operators: AgendaOperator[]
  appointments: AgendaAppointment[]
  onSlotClick: (operatorId: string, slotStartISO: string) => void
  onAppointmentClick: (appointment: AgendaAppointment) => void
}) {
  const slots = useMemo(() => buildDaySlots(), [])

  const appointmentsByOperator = useMemo(() => {
    const map = new Map<string, AgendaAppointment[]>()
    for (const appointment of appointments) {
      if (!appointment.operator_id) continue
      const list = map.get(appointment.operator_id) ?? []
      list.push(appointment)
      map.set(appointment.operator_id, list)
    }
    return map
  }, [appointments])

  if (operators.length === 0) {
    return <p className="agenda-empty-hint">Todavía no hay operadoras asignadas a esta sucursal.</p>
  }

  return (
    <div
      className="agenda-grid"
      style={{ gridTemplateColumns: `72px repeat(${operators.length}, minmax(140px, 1fr))` }}
    >
      <div className="agenda-grid-corner" style={{ gridColumn: 1, gridRow: 1 }} />
      {operators.map((operator, index) => (
        <div key={operator.id} className="agenda-grid-header" style={{ gridColumn: index + 2, gridRow: 1 }}>
          {operator.full_name ?? "Sin nombre"}
        </div>
      ))}

      {slots.map((slot, rowIndex) => (
        <div key={slot.label} className="agenda-grid-time" style={{ gridColumn: 1, gridRow: rowIndex + 2 }}>
          {slot.minute === 0 ? slot.label : ""}
        </div>
      ))}

      {operators.map((operator, colIndex) =>
        slots.map((slot) => {
          const slotStart = new Date(day)
          slotStart.setHours(slot.hour, slot.minute, 0, 0)
          const rowIndex = slots.indexOf(slot)
          return (
            <button
              key={`${operator.id}-${slot.label}`}
              type="button"
              className="agenda-grid-slot"
              style={{ gridColumn: colIndex + 2, gridRow: rowIndex + 2 }}
              onClick={() => onSlotClick(operator.id, slotStart.toISOString())}
              aria-label={`Nuevo turno para ${operator.full_name ?? "operadora"} a las ${slot.label}`}
            />
          )
        })
      )}

      {operators.map((operator, colIndex) =>
        (appointmentsByOperator.get(operator.id) ?? []).map((appointment) => {
          const startRow = slotIndexForTime(appointment.starts_at)
          const span = slotSpanForRange(appointment.starts_at, appointment.ends_at)
          if (startRow < 0 || startRow >= slots.length) return null
          return (
            <button
              key={appointment.id}
              type="button"
              className="agenda-grid-appointment"
              style={{ gridColumn: colIndex + 2, gridRow: `${startRow + 2} / span ${span}` }}
              onClick={() => onAppointmentClick(appointment)}
            >
              <span className="agenda-grid-appointment-time">{formatTime(appointment.starts_at)}</span>
              <span>{appointment.client_name ?? "Sin cliente"}</span>
              <span className="agenda-grid-appointment-services">
                {appointment.services.map((s) => s.name).join(", ")}
              </span>
              <Badge tone={STATUS_TONE[appointment.status] ?? "neutral"}>{STATUS_LABEL[appointment.status]}</Badge>
            </button>
          )
        })
      )}
    </div>
  )
}
