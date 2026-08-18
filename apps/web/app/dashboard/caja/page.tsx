import { redirect } from "next/navigation"
import { BranchPickerEmptyState } from "@/components/BranchPickerEmptyState"
import { BranchSwitcher } from "@/components/BranchSwitcher"
import { getCurrentMembership } from "@/lib/session"
import { getDefaultBranch, getTenantBranches } from "@/lib/agenda-queries"
import {
  getAppointmentCharge, getCatalog, getLastClosedSession, getOpenSession,
  getOperators, getSessionSales, getTeam,
} from "@/lib/caja-queries"
import { CajaScreen } from "./CajaScreen"
import { CashPermissionPanel } from "./CashPermissionPanel"

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ turno?: string; sucursal?: string }>
}) {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const isMulti = membership.tenants.mode === "multi"
  const params = await searchParams

  // En modo single no hace falta elegir: el fallback a getDefaultBranch NO
  // es defensivo acá, provision_tenant (0003:58) crea la membresía de la
  // dueña con branch_id = null a propósito. En multi, ese mismo fallback
  // dejaba a la dueña encerrada en la sucursal más vieja sin forma de
  // cambiar — la caja de las demás sucursales quedaba inalcanzable desde
  // acá. Ver commit 917abae para el criterio original (single-only).
  let branchId: string | null
  let branches: { id: string; name: string }[] = []
  if (isMulti) {
    branches = await getTenantBranches(membership.tenant_id)
    branchId = membership.branch_id ?? params.sucursal ?? null
  } else {
    branchId = membership.branch_id ?? (await getDefaultBranch(membership.tenant_id))?.id ?? null
  }
  if (!branchId) {
    return <BranchPickerEmptyState title="Caja" basePath="/dashboard/caja" branches={branches} />
  }

  const session = await getOpenSession(branchId)

  const [lastClosed, sales, catalog, operators, charge, team] = await Promise.all([
    session ? Promise.resolve(null) : getLastClosedSession(branchId),
    session ? getSessionSales(session.id) : Promise.resolve([]),
    getCatalog(membership.tenant_id),
    getOperators(membership.tenant_id),
    params.turno ? getAppointmentCharge(params.turno) : Promise.resolve(null),
    getTeam(membership.tenant_id),
  ])

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--space-3)" }}>
        <h1>Caja</h1>
        {/* Sólo la dueña la ve: la encargada ya llega con su branch_id fijo
            (isMulti && !membership.branch_id sólo es cierto para la dueña). */}
        {isMulti && !membership.branch_id ? (
          <BranchSwitcher branches={branches} currentBranchId={branchId} />
        ) : null}
      </div>
      {/* Solo dueña y encargada: son los únicos que pueden tocar el permiso,
          así que a una cajera el panel solo le mostraría algo que no puede
          usar. El RPC lo rechaza igual. */}
      <CashPermissionPanel tenantId={membership.tenant_id} team={team} />
      {/* key por sucursal: mismo criterio que AgendaView (ver comentario en
          agenda/page.tsx) — un remount limpio evita que el estado local
          (monto de apertura, etc.) sobreviva al cambiar de sucursal. */}
      <CajaScreen
        key={branchId}
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
