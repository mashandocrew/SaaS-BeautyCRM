import "server-only"
import { createClient } from "@beautycrm/supabase/server"

export type TeamMember = {
  user_id: string
  name: string
  email: string | null
  role: string
  branch_id: string | null
  branch_name: string | null
  can_operate_cash: boolean
  /** Dueña y encargada cobran por su rol, no por este flag — no se puede tocar. */
  cashPermissionLocked: boolean
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño/a",
  supervisor: "Encargada",
  operator: "Operadora",
}

export { ROLE_LABEL }

/** Todo el equipo del tenant, con su sucursal — para la pantalla de Configuración. */
export async function getTeamMembers(tenantId: string): Promise<TeamMember[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("memberships")
    .select("user_id, role, branch_id, can_operate_cash, users(full_name, email), branches(name)")
    .eq("tenant_id", tenantId)
    .returns<
      {
        user_id: string
        role: string
        branch_id: string | null
        can_operate_cash: boolean
        users: { full_name: string | null; email: string | null } | null
        branches: { name: string } | null
      }[]
    >()

  return (data ?? []).map((m) => {
    const locked = m.role === "owner" || m.role === "supervisor"
    return {
      user_id: m.user_id,
      name: m.users?.full_name ?? m.users?.email ?? "Sin nombre",
      email: m.users?.email ?? null,
      role: m.role,
      branch_id: m.branch_id,
      branch_name: m.branches?.name ?? null,
      can_operate_cash: locked || m.can_operate_cash,
      cashPermissionLocked: locked,
    }
  })
}
