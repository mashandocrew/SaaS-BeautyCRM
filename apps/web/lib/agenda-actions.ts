"use server"

import { createClient } from "@beautycrm/supabase/server"
import type { Database } from "@beautycrm/supabase/types"
import { revalidatePath } from "next/cache"
import { agendaErrorCode, agendaErrorMessage } from "./agenda-errors"
import type { AgendaStatus } from "./agenda-types"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

type AppointmentSource = Database["public"]["Enums"]["appointment_source"]

export async function bookAppointment(input: {
  branchId: string
  clientId: string | null
  operatorId: string | null
  startsAt: string
  serviceIds: string[]
  source?: AppointmentSource
}): Promise<ActionResult<{ appointmentId: string; startsAt: string; endsAt: string }>> {
  if (input.serviceIds.length === 0) {
    return { ok: false, error: "Elegí al menos un servicio." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida. Iniciá sesión de nuevo." }

  // NOTA: los tipos generados por Supabase para Args de funciones RPC nunca
  // incluyen `| null`, aunque la función SQL (migrations/0007_agenda_module.sql)
  // acepta NULL en p_client_id (walk-in sin cliente registrado) y p_operator_id
  // (owner/supervisor reservando sin asignar operador). Es una limitación
  // conocida del generador, no un indicio de que types.ts esté mal regenerado.
  const { data, error } = await supabase.rpc("book_appointment", {
    p_branch_id: input.branchId,
    p_client_id: input.clientId as string,
    p_operator_id: input.operatorId as string,
    p_starts_at: input.startsAt,
    p_service_ids: input.serviceIds,
    p_source: input.source ?? "internal",
  })

  if (error) {
    return { ok: false, error: agendaErrorMessage(error), code: agendaErrorCode(error) }
  }

  const row = data?.[0]
  if (!row) return { ok: false, error: "No pudimos crear el turno. Probá de nuevo." }

  revalidatePath("/dashboard/agenda")
  revalidatePath("/o")

  return {
    ok: true,
    data: { appointmentId: row.appointment_id, startsAt: row.starts_at, endsAt: row.ends_at },
  }
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: AgendaStatus
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  // RLS puede filtrar este UPDATE (ej. una operadora tratando de cambiar el
  // turno de otra) sin que Postgres tire error: simplemente afecta 0 filas
  // y `error` queda null. Pedimos .select().maybeSingle() para distinguir
  // "se actualizó una fila" de "RLS bloqueó todo en silencio" y devolver
  // {ok:false} en ese caso en vez de reportar éxito sin haber cambiado nada.
  const { data, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .select("id")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos actualizar el turno." }

  revalidatePath("/dashboard/agenda")
  revalidatePath("/o")

  return { ok: true, data: undefined }
}

export type ClientSearchResult = { id: string; full_name: string; phone: string | null }

export async function searchClients(
  tenantId: string,
  query: string
): Promise<ActionResult<ClientSearchResult[]>> {
  if (query.trim().length < 2) return { ok: true, data: [] }

  // Sanitizamos antes de interpolar en .or(): una coma o un paréntesis en
  // el input del usuario rompe la sintaxis del filtro PostgREST (coma
  // separa condiciones, paréntesis abre/cierra grupos), lo que puede
  // convertir la búsqueda en un filtro distinto al que el usuario escribió.
  const safeQuery = query.replace(/[,()]/g, " ").trim()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("clients")
    .select("id, full_name, phone")
    .eq("tenant_id", tenantId)
    .or(`full_name.ilike.%${safeQuery}%,phone.ilike.%${safeQuery}%`)
    .order("full_name")
    .limit(10)

  if (error) return { ok: false, error: "No pudimos buscar clientes." }

  return { ok: true, data: data ?? [] }
}

export async function createQuickClient(
  tenantId: string,
  input: { fullName: string; phone: string }
): Promise<ActionResult<ClientSearchResult>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase
    .from("clients")
    .insert({ tenant_id: tenantId, full_name: input.fullName, phone: input.phone })
    .select("id, full_name, phone")
    .single()

  if (error || !data) return { ok: false, error: "No pudimos crear el cliente." }

  return { ok: true, data }
}
