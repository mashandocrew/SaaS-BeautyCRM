import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getDefaultBranch } from "@/lib/agenda-queries"
import {
  getCatalog, getLastClosedSession, getOpenSession, getOperators, getSessionSales,
} from "@/lib/caja-queries"
import { CajaScreen } from "@/app/dashboard/caja/CajaScreen"

/**
 * La caja de la cajera, dentro del área operativa.
 *
 * Es la MISMA pantalla que /dashboard/caja, montada acá en vez de abrir
 * /dashboard a las operadoras: las páginas de Clientes, Inventario y
 * Servicios no chequean rol por su cuenta — confían en el redirect general
 * de dashboard/layout.tsx:17. Aflojar ese redirect obligaría a poner una
 * guarda en cada página, y alcanza con olvidarse de una para filtrar datos.
 *
 * Sin panel de permisos y sin cobro de turnos por ?turno=: eso vive en el
 * dashboard. Acá se cobra de mostrador y se maneja el cajón.
 */
export default async function OperatorCajaPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  // La barrera real está en los RPC (app.can_operate_cash), que rechazan con
  // 42501. Ésta es la de la UI: sin el permiso no tiene sentido ver la
  // pantalla.
  if (!membership.can_operate_cash && membership.role === "operator") redirect("/o")

  const branchId = membership.branch_id ?? (await getDefaultBranch(membership.tenant_id))?.id ?? null
  if (!branchId) redirect("/o")

  const session = await getOpenSession(branchId)

  const [lastClosed, sales, catalog, operators] = await Promise.all([
    session ? Promise.resolve(null) : getLastClosedSession(branchId),
    session ? getSessionSales(session.id) : Promise.resolve([]),
    getCatalog(membership.tenant_id),
    getOperators(membership.tenant_id),
  ])

  return (
    <div style={{ padding: "var(--space-4)" }}>
      <h1>Caja</h1>
      <CajaScreen
        branchId={branchId}
        session={session}
        lastClosed={lastClosed}
        sales={sales}
        catalog={catalog}
        operators={operators}
        charge={null}
        role={membership.role}
      />
    </div>
  )
}
