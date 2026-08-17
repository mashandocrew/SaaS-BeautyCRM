"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { BomLine, ServiceInput, ServiceRecord } from "./service-types"

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

  // Borrado suave vía RPC, no un DELETE: la fila tiene que sobrevivir para
  // que el historial siga siendo legible (los turnos guardan su
  // price_snapshot en appointment_services, y v_client_history saca el
  // nombre del servicio joineando services por id). Ver
  // migrations/0011_service_soft_delete.sql para el razonamiento completo.
  // El RPC además chequea que sea el dueño, que es lo que la policy
  // services_delete garantizaba para el DELETE real.
  const { error } = await supabase.rpc("soft_delete_service", { p_service_id: serviceId })

  if (error) {
    // Códigos que levanta app.soft_delete_service a propósito.
    if (error.code === "42501") {
      return { ok: false, error: "Solo el dueño puede eliminar servicios.", code: error.code }
    }
    if (error.code === "22023") {
      return { ok: false, error: "Ese servicio ya no existe.", code: error.code }
    }
    return { ok: false, error: "No pudimos eliminar el servicio." }
  }

  revalidatePath("/dashboard/servicios")
  revalidatePath("/dashboard/agenda")
  return { ok: true, data: undefined }
}

/**
 * Reemplaza el BOM completo de un servicio: qué insumos consume y cuánto.
 *
 * Va por RPC porque es un reemplazo (borrar las líneas viejas, insertar las
 * nuevas) y tiene que ser atómico: una falla en el medio dejaría el servicio
 * consumiendo insumos equivocados, y eso descuenta stock mal en CADA venta
 * posterior, en silencio. Ver migrations/0015.
 */
export async function setServiceBom(serviceId: string, lines: BomLine[]): Promise<ActionResult> {
  for (const l of lines) {
    if (!Number.isFinite(l.quantity_consumed) || l.quantity_consumed <= 0) {
      return { ok: false, error: "La cantidad de cada insumo tiene que ser mayor a 0." }
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_service_bom", {
    p_service_id: serviceId,
    p_lines: lines,
  })
  if (error) {
    if (error.message.includes("INVALID_BOM_QUANTITY")) {
      return { ok: false, error: "La cantidad de cada insumo tiene que ser mayor a 0.", code: error.code }
    }
    if (error.message.includes("SUPPLY_NOT_FOUND")) {
      return { ok: false, error: "Alguno de los insumos ya no existe.", code: error.code }
    }
    if (error.code === "42501") {
      return { ok: false, error: "No tenés permiso para cambiar los insumos de un servicio.", code: error.code }
    }
    return { ok: false, error: "No pudimos guardar los insumos del servicio.", code: error.code }
  }

  revalidatePath("/dashboard/servicios")
  revalidatePath("/dashboard/inventario")
  return { ok: true, data: undefined }
}
