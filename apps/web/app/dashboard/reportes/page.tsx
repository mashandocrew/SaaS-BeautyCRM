import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getTenantBranches } from "@/lib/agenda-queries"
import {
  getAppointmentsByStatus, getInventoryValuation, getSalesDetailForExport, getSalesSummary, getTopItems,
} from "@/lib/reportes-queries"
import { AppointmentsStatusCard } from "./AppointmentsStatusCard"
import { ExportCsvButton } from "./ExportCsvButton"
import { ReportesFilters } from "./ReportesFilters"
import { ReportesSummary } from "./ReportesSummary"
import { TopItemsTable } from "./TopItemsTable"

function firstDayOfMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; sucursal?: string }>
}) {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")
  // Mismo criterio que cash_sessions_select (0001): reportes financieros no
  // son cosa de operadora. La encargada entra pero queda fija en su sucursal.
  if (membership.role !== "owner" && membership.role !== "supervisor") redirect("/dashboard")

  const params = await searchParams
  const from = params.desde ?? firstDayOfMonth()
  // Rango exclusivo por el lado de "hasta" en las queries (`lt`), así que se
  // manda el día siguiente para que el día elegido quede incluido entero.
  const toInput = params.hasta ?? today()
  const toExclusive = new Date(`${toInput}T00:00:00`)
  toExclusive.setDate(toExclusive.getDate() + 1)
  const to = toExclusive.toISOString().slice(0, 10)

  const isMulti = membership.tenants.mode === "multi"
  const branchId = membership.role === "supervisor" ? membership.branch_id : (params.sucursal ?? null)

  const filters = { from, to, branchId }

  const [summary, topItems, appointmentCounts, inventoryValuation, exportRows, branches] = await Promise.all([
    getSalesSummary(membership.tenant_id, filters),
    getTopItems(membership.tenant_id, filters),
    getAppointmentsByStatus(membership.tenant_id, filters),
    getInventoryValuation(membership.tenant_id),
    getSalesDetailForExport(membership.tenant_id, filters),
    isMulti && membership.role === "owner" ? getTenantBranches(membership.tenant_id) : Promise.resolve(null),
  ])

  return (
    <div>
      <h1>Reportes</h1>
      <ReportesFilters from={from} to={toInput} branchId={branchId} branches={branches} />
      <ReportesSummary summary={summary} inventoryValuation={inventoryValuation} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <TopItemsTable title="Top servicios" items={topItems.services} />
        <TopItemsTable title="Top productos" items={topItems.products} />
        <AppointmentsStatusCard counts={appointmentCounts} />
      </div>

      <ExportCsvButton rows={exportRows} from={from} to={toInput} />
    </div>
  )
}
