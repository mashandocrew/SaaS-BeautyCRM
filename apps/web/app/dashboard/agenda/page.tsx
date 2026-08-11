import { redirect } from "next/navigation"
import { CalendarBlank } from "@phosphor-icons/react/dist/ssr"
import { EmptyState } from "@beautycrm/ui"
import { getCurrentMembership } from "@/lib/session"
import {
  getAgendaAppointments,
  getBranchOperators,
  getActiveServices,
  getDefaultBranch,
} from "@/lib/agenda-queries"
import { addDays, startOfWeek } from "@/lib/agenda-time"
import { AgendaView } from "./AgendaView"

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>
}) {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const isMulti = membership.tenants.mode === "multi"
  const params = await searchParams

  let branchId: string | null = null
  if (isMulti) {
    branchId = params.branch ?? membership.branch_id ?? null
  } else {
    const defaultBranch = await getDefaultBranch(membership.tenant_id)
    branchId = defaultBranch?.id ?? null
  }

  if (!branchId) {
    return (
      <div>
        <h1>Agenda</h1>
        <div className="card">
          <EmptyState
            icon={<CalendarBlank size={24} weight="regular" />}
            title="Elegí una sucursal"
            description="Seleccioná una sucursal para ver y cargar turnos."
          />
        </div>
      </div>
    )
  }

  const weekStart = startOfWeek(new Date())
  const weekEnd = addDays(weekStart, 7)

  const [appointments, operators, services] = await Promise.all([
    getAgendaAppointments(membership.tenant_id, weekStart.toISOString(), weekEnd.toISOString(), { branchId }),
    getBranchOperators(membership.tenant_id, branchId),
    getActiveServices(membership.tenant_id),
  ])

  return (
    <AgendaView
      tenantId={membership.tenant_id}
      branchId={branchId}
      weekStartISO={weekStart.toISOString()}
      initialAppointments={appointments}
      operators={operators}
      services={services}
    />
  )
}
