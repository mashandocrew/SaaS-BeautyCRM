"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { Branch, BranchInput } from "./sucursales-types"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

function validateInput(input: BranchInput): string | null {
  if (!input.name.trim()) return "El nombre es obligatorio."
  return null
}

function revalidateAll() {
  // tenants.mode y branches los leen todas estas rutas para el selector de
  // sucursal (doc A.3) — sin esto quedarían mostrando el estado viejo hasta
  // la próxima navegación.
  revalidatePath("/dashboard/sucursales")
  revalidatePath("/dashboard/agenda")
  revalidatePath("/dashboard/inventario")
  revalidatePath("/dashboard/caja")
  revalidatePath("/dashboard/reportes")
}

export async function createBranch(tenantId: string, input: BranchInput): Promise<ActionResult<Branch>> {
  const invalid = validateInput(input)
  if (invalid) return { ok: false, error: invalid }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("branches")
    .insert({ tenant_id: tenantId, name: input.name.trim(), address: input.address, phone: input.phone })
    .select("id, name, address, phone, is_active")
    .single()

  if (error || !data) return { ok: false, error: "No pudimos crear la sucursal. Puede que no tengas permiso.", code: error?.code }

  revalidateAll()
  return { ok: true, data }
}

export async function updateBranch(branchId: string, input: BranchInput): Promise<ActionResult<Branch>> {
  const invalid = validateInput(input)
  if (invalid) return { ok: false, error: invalid }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("branches")
    .update({ name: input.name.trim(), address: input.address, phone: input.phone })
    .eq("id", branchId)
    .select("id, name, address, phone, is_active")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos actualizar la sucursal. Puede que no tengas permiso.", code: error?.code }

  revalidateAll()
  return { ok: true, data }
}

/**
 * Antes de desactivar, cuenta cuántas sucursales activas quedan: si es la
 * última, el tenant se queda sin sucursal operativa y getDefaultBranch
 * (usado por el fallback de la dueña en Agenda/Inventario/Caja) deja de
 * encontrar una. No es un invariante que la base pueda expresar con un
 * check — depende de las filas hermanas.
 */
export async function toggleBranchActive(tenantId: string, branchId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient()

  if (!isActive) {
    const { count } = await supabase
      .from("branches")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", true)

    if ((count ?? 0) <= 1) {
      return { ok: false, error: "No podés desactivar la única sucursal activa del salón." }
    }
  }

  const { data, error } = await supabase
    .from("branches")
    .update({ is_active: isActive })
    .eq("id", branchId)
    .select("id")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos cambiar el estado. Puede que no tengas permiso.", code: error?.code }

  revalidateAll()
  return { ok: true, data: undefined }
}

/** Sólo dueña: tenants_update es owner-only (0001). No soporta volver a 'single'. */
export async function setTenantMode(tenantId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("tenants")
    .update({ mode: "multi" })
    .eq("id", tenantId)
    .select("id")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos cambiar el modo. Puede que no tengas permiso.", code: error?.code }

  revalidateAll()
  return { ok: true, data: undefined }
}
