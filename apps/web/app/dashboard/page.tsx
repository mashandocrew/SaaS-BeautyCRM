import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getDashboardData, type AppointmentRow, type StockAlertRow } from "./queries"
import { StatTile, Badge, EmptyState } from "@beautycrm/ui"

const STATUS_LABEL: Record<string, string> = {
  booked: "Reservado",
  confirmed: "Confirmado",
  in_progress: "En curso",
  done: "Hecho",
  no_show: "No vino",
  cancelled: "Cancelado",
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
}

export default async function DashboardPage() {
  const { membership } = await getCurrentMembership()
  if (!membership) redirect("/onboarding")

  const data = await getDashboardData(membership.tenant_id)

  return (
    <div>
      <h1>Hola, {membership.tenants.business_name}</h1>

      {membership.tenants.subscription_status === "promo" && membership.tenants.promo_ends_at ? (
        <p className="promo-banner">
          Precio promocional $40/mes hasta el{" "}
          {new Date(membership.tenants.promo_ends_at).toLocaleDateString("es-AR")}, luego $100/mes.
        </p>
      ) : null}

      <div className="stat-grid">
        <StatTile label="Turnos de hoy" value={data.todayAppointments.length} />
        <StatTile label="Ingresos de hoy" value={formatCurrency(data.todayRevenue)} />
        <StatTile label="Ingresos del mes" value={formatCurrency(data.monthRevenue)} />
        <StatTile
          label="Comisiones del mes"
          value={formatCurrency(data.monthCommissionsTotal)}
        />
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Turnos de hoy</h2>
        {data.todayAppointments.length === 0 ? (
          <EmptyState
            title="Sin turnos hoy"
            description="Cuando se agende un turno para hoy, va a aparecer acá."
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cliente</th>
                <th>Operadora</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.todayAppointments.map((a: AppointmentRow) => (
                <tr key={a.id}>
                  <td>{formatTime(a.starts_at)}</td>
                  <td>{a.clients?.full_name ?? "—"}</td>
                  <td>{a.users?.full_name ?? "—"}</td>
                  <td>
                    <Badge tone={a.status === "done" ? "success" : "neutral"}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Alertas de stock</h2>
        {data.stockAlerts.length === 0 ? (
          <EmptyState
            title="Todo en orden"
            description="Ningún insumo o producto está por debajo del mínimo."
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Sucursal</th>
                <th>Tipo</th>
                <th>Stock actual</th>
                <th>Mínimo</th>
              </tr>
            </thead>
            <tbody>
              {data.stockAlerts.map((item: StockAlertRow, i: number) => (
                <tr key={i}>
                  <td>{item.branches?.name ?? "—"}</td>
                  <td>{item.item_type === "supply" ? "Insumo" : "Producto"}</td>
                  <td>
                    <Badge tone="danger">{item.current_stock}</Badge>
                  </td>
                  <td>{item.min_alert_level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
