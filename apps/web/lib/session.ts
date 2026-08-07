import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { Tables } from "@beautycrm/supabase/types"

export type CurrentMembership = Tables<"memberships"> & {
  tenants: Tables<"tenants">
  branches: Tables<"branches"> | null
}

/**
 * Devuelve el usuario autenticado y su membership principal.
 * Un usuario puede tener varias membresías (multi-tenant a futuro), pero
 * el alcance de esta sesión es un tenant por owner/operador — se toma la
 * primera. Si no tiene ninguna, todavía no pasó por el onboarding.
 */
export async function getCurrentMembership() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { user: null, membership: null }

  const { data: membership } = await supabase
    .from("memberships")
    .select("*, tenants(*), branches(*)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle()

  return { user, membership: membership as CurrentMembership | null }
}
