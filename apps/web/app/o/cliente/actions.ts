"use server"

import { createClient } from "@beautycrm/supabase/server"
import type { TablesInsert } from "@beautycrm/supabase/types"
import { revalidatePath } from "next/cache"

export async function addTechnicalNote(input: {
  tenantId: string
  clientId: string
  appointmentId: string | null
  technicalNotes: string
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "Sesión inválida." }

  const payload: TablesInsert<"client_history"> = {
    tenant_id: input.tenantId,
    client_id: input.clientId,
    appointment_id: input.appointmentId,
    operator_id: user.id,
    technical_notes: input.technicalNotes,
  }
  const { error } = await supabase.from("client_history").insert(payload)

  if (error) return { ok: false as const, error: "No pudimos guardar la nota." }

  revalidatePath("/o/cliente")
  return { ok: true as const }
}
