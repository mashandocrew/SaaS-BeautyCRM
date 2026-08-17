import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { currentPeriod, getCommissionRules, getPeriodLedger, getTeamWithRules } from "@/lib/comisiones-queries"
import { CommissionRulesPanel } from "./CommissionRulesPanel"
import { CommissionSettlementPanel } from "./CommissionSettlementPanel"

export default async function ComisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")
  // commission_rules_insert/update/delete y memberships_update ya son
  // owner-only (0001): una encargada llegaría hasta acá y no podría hacer
  // nada, así que directamente no se le muestra la pantalla.
  if (membership.role !== "owner") redirect("/dashboard")

  const params = await searchParams
  const period = params.periodo ?? currentPeriod()

  const [rules, team, totals] = await Promise.all([
    getCommissionRules(membership.tenant_id),
    getTeamWithRules(membership.tenant_id),
    getPeriodLedger(membership.tenant_id, period),
  ])

  return (
    <div>
      <h1>Comisiones</h1>
      <CommissionRulesPanel tenantId={membership.tenant_id} rules={rules} team={team} />
      <div style={{ marginTop: "var(--space-4)" }}>
        <CommissionSettlementPanel tenantId={membership.tenant_id} period={period} totals={totals} />
      </div>
    </div>
  )
}
