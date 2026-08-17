import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { Branch } from "./sucursales-types"

/** Todas las sucursales, activas e inactivas — a diferencia de getTenantBranches (Agenda), que sólo trae activas. */
export async function getBranches(tenantId: string): Promise<Branch[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("branches")
    .select("id, name, address, phone, is_active")
    .eq("tenant_id", tenantId)
    .order("created_at")

  return data ?? []
}
