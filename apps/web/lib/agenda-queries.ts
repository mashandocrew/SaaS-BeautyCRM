import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { AgendaAppointment, AgendaOperator, AgendaService } from "./agenda-types"

export async function getAgendaAppointments(
  tenantId: string,
  rangeStartISO: string,
  rangeEndISO: string,
  filters?: { branchId?: string | null; operatorId?: string | null }
): Promise<AgendaAppointment[]> {
  const supabase = await createClient()
  let query = supabase
    .from("v_agenda")
    .select("*")
    .eq("tenant_id", tenantId)
    .gte("starts_at", rangeStartISO)
    .lt("starts_at", rangeEndISO)
    .order("starts_at", { ascending: true })

  if (filters?.branchId) query = query.eq("branch_id", filters.branchId)
  if (filters?.operatorId) query = query.eq("operator_id", filters.operatorId)

  const { data } = await query.returns<AgendaAppointment[]>()

  // numeric de Postgres puede llegar como string por JSON — se normaliza acá
  // para que el resto del código pueda operar aritméticamente sin sorpresas.
  return (data ?? []).map((row) => ({
    ...row,
    total_price: Number(row.total_price),
    services: row.services.map((s) => ({ ...s, price_snapshot: Number(s.price_snapshot) })),
  }))
}

type MembershipOperatorRow = {
  user_id: string
  users: { id: string; full_name: string | null } | null
}

export async function getBranchOperators(
  tenantId: string,
  branchId?: string | null
): Promise<AgendaOperator[]> {
  const supabase = await createClient()
  let query = supabase
    .from("memberships")
    .select("user_id, users(id, full_name)")
    .eq("tenant_id", tenantId)
    .eq("role", "operator")

  if (branchId) query = query.eq("branch_id", branchId)

  const { data } = await query.returns<MembershipOperatorRow[]>()
  return (data ?? []).map((m) => m.users).filter((u): u is AgendaOperator => u !== null)
}

export async function getActiveServices(tenantId: string): Promise<AgendaService[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("services")
    .select("id, name, duration_minutes, price")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name")
    .returns<AgendaService[]>()

  return (data ?? []).map((s) => ({ ...s, price: Number(s.price) }))
}

export async function getDefaultBranch(tenantId: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  return data ?? null
}
