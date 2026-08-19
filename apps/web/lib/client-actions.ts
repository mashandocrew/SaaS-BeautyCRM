"use server"

// Alias porque este archivo exporta su propia función `createClient` (alta
// de cliente de negocio) — sin el alias colisionaría con el factory de
// Supabase.
import { createClient as createSupabaseClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { ClientRecord } from "./client-types"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

export type ClientInput = {
  fullName: string
  phone: string | null
  email: string | null
  birthday: string | null
  notes: string | null
}

export async function createClient(
  tenantId: string,
  input: ClientInput,
  /** true cuando ya se avisó del teléfono duplicado y se confirmó igual. */
  confirmDuplicatePhone = false,
): Promise<ActionResult<ClientRecord>> {
  if (!input.fullName.trim()) return { ok: false, error: "El nombre es obligatorio." }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  // El teléfono es el identificador natural del cliente en un salón
  // (WhatsApp, recordatorios) — cargar dos personas distintas con el mismo
  // número sin avisar mezcla sus historiales en la práctica. No se bloquea
  // (puede ser legítimo: familia compartiendo un teléfono), pero se avisa
  // antes de crear.
  if (input.phone && !confirmDuplicatePhone) {
    const { data: existing } = await supabase
      .from("clients")
      .select("full_name")
      .eq("tenant_id", tenantId)
      .eq("phone", input.phone)
      .limit(1)
      .maybeSingle()
    if (existing) {
      return {
        ok: false,
        error: `Ya hay un cliente con este teléfono: ${existing.full_name}.`,
        code: "PHONE_DUPLICATE",
      }
    }
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({
      tenant_id: tenantId,
      full_name: input.fullName.trim(),
      phone: input.phone,
      email: input.email,
      birthday: input.birthday,
      notes: input.notes,
    })
    .select("*")
    .single()

  if (error || !data) return { ok: false, error: "No pudimos crear el cliente." }

  revalidatePath("/dashboard/clientes")
  return { ok: true, data }
}

export async function updateClient(clientId: string, input: ClientInput): Promise<ActionResult<ClientRecord>> {
  if (!input.fullName.trim()) return { ok: false, error: "El nombre es obligatorio." }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  // .select().maybeSingle() en vez de solo comprobar `error`: si RLS
  // bloquea el UPDATE (fila de otro tenant), Postgres no tira error,
  // simplemente actualiza 0 filas — mismo patrón que
  // updateAppointmentStatus en lib/agenda-actions.ts.
  const { data, error } = await supabase
    .from("clients")
    .update({
      full_name: input.fullName.trim(),
      phone: input.phone,
      email: input.email,
      birthday: input.birthday,
      notes: input.notes,
    })
    .eq("id", clientId)
    .select("*")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos actualizar el cliente." }

  revalidatePath("/dashboard/clientes")
  revalidatePath(`/dashboard/clientes/${clientId}`)
  return { ok: true, data }
}

export async function deleteClient(clientId: string): Promise<ActionResult> {
  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase.from("clients").delete().eq("id", clientId).select("id").maybeSingle()

  if (error) {
    // 23503 = foreign_key_violation. clients no tiene ON DELETE CASCADE
    // desde appointments/client_history/sales (migrations/0001) a
    // propósito: un cliente con historial real no se borra silenciosamente.
    if (error.code === "23503") {
      return {
        ok: false,
        error: "No se puede eliminar: esta persona tiene turnos o historial asociado.",
        code: error.code,
      }
    }
    return { ok: false, error: "No pudimos eliminar el cliente." }
  }
  if (!data) return { ok: false, error: "No pudimos eliminar el cliente. Puede que no tengas permiso." }

  revalidatePath("/dashboard/clientes")
  return { ok: true, data: undefined }
}

export async function updateHistoryNotes(historyId: string, notes: string): Promise<ActionResult> {
  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  // Mismo criterio que ClientFormSheet.tsx para sus propios campos: una
  // nota vaciada por el usuario se guarda como NULL, no como "". Si no,
  // "" ?? <span>Agregar nota</span> devuelve "" (nullish coalescing solo
  // cae al fallback con null/undefined, no con string vacío) y el botón de
  // ClientHistoryTable.tsx queda sin texto visible ni nombre accesible.
  const normalizedNotes = notes.trim() || null

  const { data, error } = await supabase
    .from("client_history")
    .update({ technical_notes: normalizedNotes })
    .eq("id", historyId)
    .select("id")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos guardar la nota. Puede que no tengas permiso." }

  // router.refresh() en ClientHistoryTable.tsx cubre /dashboard/clientes/[id],
  // pero la operadora ve la misma nota técnica en /o/cliente (ver
  // app/o/cliente/page.tsx) — sin esto queda stale si el dueño la edita.
  revalidatePath("/o/cliente")
  return { ok: true, data: undefined }
}
