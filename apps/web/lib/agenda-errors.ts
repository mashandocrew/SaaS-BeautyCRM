export const AGENDA_ERROR_MESSAGES: Record<string, string> = {
  OPERATOR_BUSY: "Esa persona ya tiene un turno en ese horario.",
  INVALID_SERVICE_SELECTION: "Uno de los servicios elegidos no existe o está inactivo.",
  NOT_ALLOWED_TO_BOOK_FOR_THIS_OPERATOR: "No podés agendar turnos para otra persona.",
  BRANCH_NOT_FOUND: "Hubo un problema con la configuración de la sucursal. Contactá a soporte.",
  NOT_A_MEMBER: "Hubo un problema con la configuración de la sucursal. Contactá a soporte.",
}

const GENERIC_ERROR = "No se pudo crear el turno. Probá de nuevo."

export function agendaErrorCode(error: { message: string }): string | null {
  return Object.keys(AGENDA_ERROR_MESSAGES).find((code) => error.message.includes(code)) ?? null
}

export function agendaErrorMessage(error: { message: string } | null | undefined): string {
  if (!error) return GENERIC_ERROR
  const code = agendaErrorCode(error)
  return code ? AGENDA_ERROR_MESSAGES[code] : GENERIC_ERROR
}
