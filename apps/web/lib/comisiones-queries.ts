import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { CommissionRule, OperatorPeriodTotal, TeamCommissionMember } from "./comisiones-types"

export async function getCommissionRules(tenantId: string): Promise<CommissionRule[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("commission_rules")
    .select("id, name, base_salary, service_pct, product_sale_pct")
    .eq("tenant_id", tenantId)
    .order("name")

  return (data ?? []).map((r) => ({
    ...r,
    base_salary: Number(r.base_salary),
    service_pct: Number(r.service_pct),
    product_sale_pct: Number(r.product_sale_pct),
  }))
}

/** El equipo del salón con la regla que tiene asignada, para el panel de asignación. */
export async function getTeamWithRules(tenantId: string): Promise<TeamCommissionMember[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("memberships")
    .select("user_id, role, commission_rule_id, users(full_name)")
    .eq("tenant_id", tenantId)
    .returns<
      { user_id: string; role: string; commission_rule_id: string | null; users: { full_name: string | null } | null }[]
    >()

  return (data ?? []).map((m) => ({
    user_id: m.user_id,
    name: m.users?.full_name ?? "Sin nombre",
    role: m.role,
    commission_rule_id: m.commission_rule_id,
  }))
}

/**
 * El ledger de un período, sumado por operadora.
 *
 * commission_ledger_select ya filtra a "la propia o si sos dueña, todas" —
 * acá siempre entra como dueña, así que trae el tenant completo.
 */
export async function getPeriodLedger(tenantId: string, period: string): Promise<OperatorPeriodTotal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("commission_ledger")
    .select("operator_id, amount, settled, users(full_name)")
    .eq("tenant_id", tenantId)
    .eq("period", period)
    .returns<{ operator_id: string; amount: number; settled: boolean; users: { full_name: string | null } | null }[]>()

  const byOperator = new Map<string, OperatorPeriodTotal>()
  for (const row of data ?? []) {
    const current = byOperator.get(row.operator_id) ?? {
      operator_id: row.operator_id,
      operator_name: row.users?.full_name ?? "Sin nombre",
      earned: 0,
      settled: 0,
      pending: 0,
    }
    const amount = Number(row.amount)
    current.earned += amount
    if (row.settled) current.settled += amount
    else current.pending += amount
    byOperator.set(row.operator_id, current)
  }

  return Array.from(byOperator.values()).sort((a, b) => a.operator_name.localeCompare(b.operator_name))
}

export function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}
