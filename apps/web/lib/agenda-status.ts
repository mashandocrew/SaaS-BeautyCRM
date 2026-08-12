import type { AgendaStatus } from "./agenda-types"

// Único lugar donde vive el vocabulario de estados de turno en español —
// antes duplicado (y parcialmente en inglés) entre MiDiaList.tsx,
// AgendaGrid.tsx y AppointmentDetailPanel.tsx. Cualquier superficie nueva
// que muestre el status de un turno debe importar de acá, no redefinir
// su propio mapa local.
export const STATUS_LABEL: Record<AgendaStatus, string> = {
  booked: "Reservado",
  confirmed: "Confirmado",
  in_progress: "En curso",
  done: "Hecho",
  no_show: "No vino",
  cancelled: "Cancelado",
}

export const STATUS_TONE: Record<AgendaStatus, "neutral" | "success" | "warning" | "danger"> = {
  booked: "neutral",
  confirmed: "warning",
  in_progress: "warning",
  done: "success",
  no_show: "danger",
  cancelled: "danger",
}

export const NEXT_STATUS: Partial<Record<AgendaStatus, { status: AgendaStatus; label: string }>> = {
  booked: { status: "confirmed", label: "Confirmar" },
  confirmed: { status: "in_progress", label: "Iniciar" },
  in_progress: { status: "done", label: "Completar" },
}

// Un turno en cualquiera de estos tres estados es terminal: ya no admite
// más transiciones de status (ni "confirmar/iniciar/completar" ni
// "no asistió"/"cancelar"). Antes cada pantalla ad-hoceaba su propia
// condición y quedaban desincronizadas — ver hallazgo de revisión de rama
// completa: AppointmentDetailPanel excluía done/cancelled pero no no_show.
export function canChangeStatus(status: AgendaStatus): boolean {
  return status !== "done" && status !== "cancelled" && status !== "no_show"
}
