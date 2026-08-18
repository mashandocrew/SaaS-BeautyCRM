import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getTenantBranches } from "@/lib/agenda-queries"
import { getCommissionRules } from "@/lib/comisiones-queries"
import { getTeamMembers } from "@/lib/team-queries"
import { BusinessInfoForm } from "./BusinessInfoForm"
import { SubscriptionCard } from "./SubscriptionCard"
import { TeamPanel } from "./TeamPanel"

export default async function ConfiguracionPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")
  // tenants_update es owner-only (0001), sin excepción para la encargada
  // (a diferencia de Sucursales) — una encargada llegaría hasta acá y no
  // podría guardar nada.
  if (membership.role !== "owner") redirect("/dashboard")

  const settings = (membership.tenants.settings ?? {}) as Record<string, unknown>

  const [team, branches, rules] = await Promise.all([
    getTeamMembers(membership.tenant_id),
    getTenantBranches(membership.tenant_id),
    getCommissionRules(membership.tenant_id),
  ])

  return (
    <div>
      <h1>Configuración</h1>
      <BusinessInfoForm
        tenantId={membership.tenant_id}
        businessName={membership.tenants.business_name}
        currency={typeof settings.currency === "string" ? settings.currency : "ARS"}
        timezone={typeof settings.timezone === "string" ? settings.timezone : "America/Argentina/Buenos_Aires"}
      />
      <SubscriptionCard status={membership.tenants.subscription_status} promoEndsAt={membership.tenants.promo_ends_at} />
      <TeamPanel
        tenantId={membership.tenant_id}
        members={team}
        branches={branches}
        rules={rules}
      />
    </div>
  )
}
