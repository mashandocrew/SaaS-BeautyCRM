export const AGENDA_DAY_START_HOUR = 8
export const AGENDA_DAY_END_HOUR = 21
export const AGENDA_SLOT_MINUTES = 30

export type AgendaTimeSlot = { hour: number; minute: number; label: string }

export function buildDaySlots(): AgendaTimeSlot[] {
  const slots: AgendaTimeSlot[] = []
  const totalMinutes = (AGENDA_DAY_END_HOUR - AGENDA_DAY_START_HOUR) * 60
  for (let m = 0; m < totalMinutes; m += AGENDA_SLOT_MINUTES) {
    const hour = AGENDA_DAY_START_HOUR + Math.floor(m / 60)
    const minute = m % 60
    slots.push({
      hour,
      minute,
      label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    })
  }
  return slots
}

export function slotIndexForTime(iso: string): number {
  const d = new Date(iso)
  const minutesFromDayStart = (d.getHours() - AGENDA_DAY_START_HOUR) * 60 + d.getMinutes()
  return Math.floor(minutesFromDayStart / AGENDA_SLOT_MINUTES)
}

export function slotSpanForRange(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  return Math.max(1, Math.round((end - start) / 60_000 / AGENDA_SLOT_MINUTES))
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime()
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day // lunes como inicio de semana
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
}
