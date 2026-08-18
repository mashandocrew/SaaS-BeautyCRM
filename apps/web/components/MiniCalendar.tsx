"use client"

import { useEffect, useRef, useState } from "react"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"

const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"]

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/**
 * Parsea "YYYY-MM-DD" a un Date LOCAL (no `new Date(str)`, que Chrome
 * interpreta como UTC medianoche y en GMT-3 cae un día antes de lo
 * escrito). Mismo criterio que el resto del módulo Agenda.
 */
function parseDateStr(str: string): Date {
  const [y, m, d] = str.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function todayStr(): string {
  const now = new Date()
  return toDateStr(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * Grilla de un mes, con lunes como primer día — mismo criterio que
 * lib/agenda-time.ts (startOfWeek). Trabaja con strings "YYYY-MM-DD" para
 * no arrastrar objetos Date entre el padre y este componente.
 */
export function MiniCalendar({ value, onSelect }: { value: string | null; onSelect: (dateStr: string) => void }) {
  const initial = value ? parseDateStr(value) : new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())

  const today = todayStr()
  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  // getDay(): 0 = domingo. Se convierte a "días desde el lunes" para que la
  // grilla arranque en lunes.
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  function changeMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" })

  return (
    <div className="mini-calendar">
      <div className="mini-calendar-header">
        <button type="button" onClick={() => changeMonth(-1)} aria-label="Mes anterior">
          <CaretLeft size={14} weight="bold" />
        </button>
        <span style={{ textTransform: "capitalize" }}>{monthLabel}</span>
        <button type="button" onClick={() => changeMonth(1)} aria-label="Mes siguiente">
          <CaretRight size={14} weight="bold" />
        </button>
      </div>
      <div className="mini-calendar-grid">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} className="mini-calendar-weekday">{w}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={i} />
          const dateStr = toDateStr(viewYear, viewMonth, day)
          return (
            <button
              key={i}
              type="button"
              className="mini-calendar-day"
              data-selected={dateStr === value}
              data-today={dateStr === today}
              onClick={() => onSelect(dateStr)}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Botón + popover: dispara MiniCalendar sobre un trigger con la fecha
 * elegida como texto. Usado donde antes había un `<input type="date">`
 * nativo — mismo valor "YYYY-MM-DD" adentro y afuera.
 */
export function MiniCalendarField({
  value,
  onChange,
  label,
  formatLabel,
}: {
  value: string
  onChange: (dateStr: string) => void
  label: string
  /** Formato del texto del botón. Por default, es-AR corto. */
  formatLabel?: (dateStr: string) => string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  const display = formatLabel
    ? formatLabel(value)
    : parseDateStr(value).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <label className="label">{label}</label>
      <button type="button" className="input mini-calendar-trigger" onClick={() => setOpen((v) => !v)}>
        {display}
      </button>
      {open ? (
        <div className="mini-calendar-popover">
          <MiniCalendar
            value={value}
            onSelect={(d) => {
              onChange(d)
              setOpen(false)
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
