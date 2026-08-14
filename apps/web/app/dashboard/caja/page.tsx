import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getDefaultBranch } from "@/lib/agenda-queries"
import {
  getAppointmentCharge, getCatalog, getLastClosedSession, getOpenSession,
  getOperators, getSessionSales,
} from "@/lib/caja-queries"
import { CajaScreen } from "./CajaScreen"

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ turno?: string }>
}) {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  // Sin selector de sucursal (doc A.3). El fallback a getDefaultBranch NO es
  // defensivo: provision_tenant (0003:58) crea la membresía de la dueña con
  // branch_id = null a propósito. Ver commit 917abae.
  const branchId = membership.branch_id ?? (await getDefaultBranch(membership.tenant_id))?.id ?? null
  if (!branchId) redirect("/dashboard")

  const params = await searchParams
  const session = await getOpenSession(branchId)

  const [lastClosed, sales, catalog, operators, charge] = await Promise.all([
    session ? Promise.resolve(null) : getLastClosedSession(branchId),
    session ? getSessionSales(session.id) : Promise.resolve([]),
    getCatalog(membership.tenant_id),
    getOperators(membership.tenant_id),
    params.turno ? getAppointmentCharge(params.turno) : Promise.resolve(null),
  ])

  return (
    <div>
      <h1>Caja</h1>
      <CajaScreen
        branchId={branchId}
        session={session}
        lastClosed={lastClosed}
        sales={sales}
        catalog={catalog}
        operators={operators}
        charge={charge}
        role={membership.role}
      />
    </div>
  )
}
