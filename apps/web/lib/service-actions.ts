"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { ServiceInput, ServiceRecord } from "./service-types"

// Declarado local en vez de importado de client-actions.ts: cada módulo
// declara el suyo (agenda-actions.ts y client-actions.ts hacen lo mismo),
// así ningún módulo depende del archivo de otro.
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

// No exportada: en un archivo "use server" todo lo exportado tiene que ser
// una función async (los `type` se borran en compilación y no cuentan).
function validateInput(input: ServiceInput): string | null {
  if (!input.name.trim()) return "El nombre es obligatorio."
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
    return "La duración tiene que ser mayor a 0 minutos."
  }
  if (!Number.isFinite(input.price) || input.price < 0) return "El precio no puede ser negativo."
  return null
}

export async function createService(tenantId: string, input: ServiceInput): Promise<ActionResult<ServiceRecord>> {
  const invalid = validateInput(input)
  if (invalid) return { ok: false, error: invalid }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase
    .from("services")
    .insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      duration_minutes: input.durationMinutes,
      price: input.price,
      category: input.category,
      is_active: input.isActive,
    })
    .select("*")
    .single()

  if (error || !data) return { ok: false, error: "No pudimos crear el servicio." }

  revalidatePath("/dashboard/servicios")
  // Agenda lee el catálogo para el modal de nuevo turno (getActiveServices):
  // un servicio nuevo tiene que aparecer ahí sin esperar a que expire el
  // cache de la ruta.
  revalidatePath("/dashboard/agenda")
  return { ok: true, data }
}

export async function updateService(serviceId: string, input: ServiceInput): Promise<ActionResult<ServiceRecord>> {
  const invalid = validateInput(input)
  if (invalid) return { ok: false, error: invalid }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  // .select().maybeSingle() en vez de solo mirar `error`: si RLS bloquea el
  // UPDATE (fila de otro tenant, o rol sin permiso), Postgres no tira error,
  // simplemente actualiza 0 filas — mismo patrón que updateClient.
  const { data, error } = await supabase
    .from("services")
    .update({
      name: input.name.trim(),
      duration_minutes: input.durationMinutes,
      price: input.price,
      category: input.category,
      is_active: input.isActive,
    })
    .eq("id", serviceId)
    .select("*")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos actualizar el servicio." }

  revalidatePath("/dashboard/servicios")
  revalidatePath("/dashboard/agenda")
  return { ok: true, data }
}

/**
 * Toca solamente is_active. Es la acción cotidiana para sacar un servicio
 * de circulación: el historial que ya lo referencia queda intacto y deja de
 * aparecer en el modal de nuevo turno. Sin confirmación — se deshace con un
 * clic.
 */
export async function toggleServiceActive(serviceId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase
    .from("services")
    .update({ is_active: isActive })
    .eq("id", serviceId)
    .select("id")
    .maybeSingle()

  if (error || !data) {
    return { ok: false, error: "No pudimos cambiar el estado del servicio. Puede que no tengas permiso." }
  }

  revalidatePath("/dashboard/servicios")
  revalidatePath("/dashboard/agenda")
  return { ok: true, data: undefined }
}

export async function deleteService(serviceId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase.from("services").delete().eq("id", serviceId).select("id").maybeSingle()

  if (error) {
    // 23503 = foreign_key_violation. appointment_services_service_id_fkey y
    // client_history_service_id_fkey son NO ACTION (verificado contra la base
    // real en la spec): un servicio con historial de uso no se borra
    // silenciosamente. Para eso está desactivarlo.
    if (error.code === "23503") {
      return {
        ok: false,
        error: "No se puede eliminar: este servicio ya fue usado en turnos. Desactivalo en vez de borrarlo.",
        code: error.code,
      }
    }
    return { ok: false, error: "No pudimos eliminar el servicio." }
  }
  if (!data) return { ok: false, error: "No pudimos eliminar el servicio. Puede que no tengas permiso." }

  revalidatePath("/dashboard/servicios")
  revalidatePath("/dashboard/agenda")
  return { ok: true, data: undefined }
}
