"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { BusinessInfoInput } from "./configuracion-types"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

/**
 * Lee-mergea-escribe en vez de mandar un `||` de jsonb por SQL: el cliente
 * de Supabase manda el body como JSON, no como expresión SQL, así que
 * `update({ settings: {...} })` reemplazaría el objeto entero y borraría
 * claves que esta pantalla no toca (ej. `branding`, cuando exista).
 */
export async function updateBusinessInfo(tenantId: string, input: BusinessInfoInput): Promise<ActionResult> {
  if (!input.businessName.trim()) return { ok: false, error: "El nombre es obligatorio." }

  const supabase = await createClient()
  const { data: current, error: readError } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .maybeSingle()

  if (readError || !current) return { ok: false, error: "No pudimos leer la configuración actual.", code: readError?.code }

  const mergedSettings = {
    ...(current.settings as Record<string, unknown>),
    currency: input.currency,
    timezone: input.timezone,
  }

  const { data, error } = await supabase
    .from("tenants")
    .update({ business_name: input.businessName.trim(), settings: mergedSettings })
    .eq("id", tenantId)
    .select("id")
    .maybeSingle()

  if (error || !data) {
    return { ok: false, error: "No pudimos guardar los cambios. Puede que no tengas permiso.", code: error?.code }
  }

  // El nombre del negocio se muestra en el Sidebar, que vive en el layout
  // compartido de todo /dashboard — revalida ahí, no sólo esta página.
  revalidatePath("/dashboard", "layout")
  return { ok: true, data: undefined }
}
