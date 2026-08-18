import { redirect } from "next/navigation"
import { BranchPickerEmptyState } from "@/components/BranchPickerEmptyState"
import { getCurrentMembership } from "@/lib/session"
import {
  getAgendaAppointments,
  getBranchOperators,
  getActiveServices,
  getDefaultBranch,
  getTenantBranches,
} from "@/lib/agenda-queries"
import { addDays, startOfWeek } from "@/lib/agenda-time"
import { AgendaView } from "./AgendaView"

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; week?: string }>
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
    // En modo multi, la dueña (branch_id null, no está atada a ninguna
    // sucursal) cae siempre acá hasta que elige una — a diferencia de la
    // supervisora, que ya trae la suya en membership.branch_id. Antes esto
    // era un cartel sin salida: no había forma de elegir sucursal desde acá,
    // así que la dueña quedaba trabada. Ahora se listan las sucursales para
    // que pueda entrar a la que quiera.
    const branchesForPicker = isMulti ? await getTenantBranches(membership.tenant_id) : []
    return (
      <BranchPickerEmptyState
        title="Agenda"
        basePath="/dashboard/agenda"
        paramName="branch"
        branches={branchesForPicker}
      />
    )
  }

  // startOfWeek/setHours corren en el timezone del proceso Node (TZ), no
  // en el del tenant — depende de que TZ esté fijado a
  // America/Argentina/Mendoza en next.config.js (ver comentario ahí). Sin
  // eso, en un host que usa UTC por default la semana puede arrancar el
  // día equivocado y los turnos del domingo a la noche caer fuera de la
  // ventana.
  const requestedWeek = params.week ? new Date(params.week) : new Date()
  const weekStart = startOfWeek(isNaN(requestedWeek.getTime()) ? new Date() : requestedWeek)
  const weekEnd = addDays(weekStart, 7)

  // En modo single la grilla debe mostrar las operadoras de TODO el
  // tenant (no tiene sentido filtrar por sucursal cuando solo hay una) —
  // pasamos branchId=null para no depender del filtro .or() de
  // getBranchOperators en este caso. En modo multi sí filtramos por la
  // sucursal real, y el .or() ya cubre ahí las operadoras tenant-wide.
  const [appointments, operators, services, branches] = await Promise.all([
    getAgendaAppointments(membership.tenant_id, weekStart.toISOString(), weekEnd.toISOString(), { branchId }),
    getBranchOperators(membership.tenant_id, isMulti ? branchId : null),
    getActiveServices(membership.tenant_id),
    isMulti ? getTenantBranches(membership.tenant_id) : Promise.resolve([]),
  ])

  return (
    <AgendaView
      // key fuerza un remount completo de AgendaView cuando cambia la
      // semana o la sucursal — mismo patrón ya usado en este módulo para
      // evitar el bug de "estado local que no se resincroniza con un prop
      // nuevo" (ver MiDiaList / detailAppointmentId). Un remount limpio es
      // más simple y más robusto acá que perseguir cada pieza de estado
      // con un useEffect de resincronización.
      key={`${weekStart.toISOString()}-${branchId}`}
      tenantId={membership.tenant_id}
      branchId={branchId}
      weekStartISO={weekStart.toISOString()}
      initialAppointments={appointments}
      operators={operators}
      services={services}
      branches={branches}
    />
  )
}
