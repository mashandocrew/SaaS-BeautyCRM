"use server"

import { createClient } from "@beautycrm/supabase/server"
import type { TablesInsert } from "@beautycrm/supabase/types"
import { revalidatePath } from "next/cache"

export async function addTechnicalNote(input: {
  appointmentId: string
  technicalNotes: string
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "Sesión inválida." }

  // No confiamos en tenantId/clientId que vengan del cliente: la nota
  // solo puede quedar atada al turno que realmente es de esta operadora
  // (RLS ya lo garantiza para la lectura, pero acá lo verificamos
  // explícitamente para no permitir que arme una nota para un turno o
  // cliente ajeno dentro del mismo tenant).
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, tenant_id, client_id, operator_id")
    .eq("id", input.appointmentId)
    .maybeSingle()

  if (!appointment || appointment.operator_id !== user.id || !appointment.client_id) {
    return { ok: false as const, error: "Ese turno no te pertenece." }
  }

  const payload: TablesInsert<"client_history"> = {
    tenant_id: appointment.tenant_id,
    client_id: appointment.client_id,
    appointment_id: appointment.id,
    operator_id: user.id,
    technical_notes: input.technicalNotes,
  }
  const { error } = await supabase.from("client_history").insert(payload)

  if (error) return { ok: false as const, error: "No pudimos guardar la nota." }

  revalidatePath("/o/cliente")
  return { ok: true as const }
}
