import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { AgendaAppointment, AgendaBranch, AgendaOperator, AgendaService } from "./agenda-types"

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

  // memberships.branch_id puede ser NULL (membership de alcance
  // tenant-wide, ver migrations/0001_initial_schema.sql y el mismo patrón
  // ya usado en app.user_branch_ids: "branch_id is null or branch_id = b.id").
  // Un filtro .eq("branch_id", branchId) descarta exactamente esas filas —
  // una operadora tenant-wide dejaba de aparecer en la grilla de cualquier
  // sucursal puntual. .or() incluye ambos casos: NULL o esta sucursal.
  if (branchId) query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`)

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
    // Redundante con is_active (eliminar también desactiva, ver
    // migrations/0011), pero explícito: si algún día un servicio eliminado
    // se reactivara por otra vía, igual no debe ofrecerse en un turno nuevo.
    .is("deleted_at", null)
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

export async function getTenantBranches(tenantId: string): Promise<AgendaBranch[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name")

  return data ?? []
}
