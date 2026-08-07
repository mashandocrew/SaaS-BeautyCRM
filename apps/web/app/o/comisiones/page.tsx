import { redirect } from "next/navigation"
import { createClient } from "@beautycrm/supabase/server"
import { getCurrentMembership } from "@/lib/session"
import { StatTile, EmptyState, Badge } from "@beautycrm/ui"

function formatCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export default async function MisComisionesPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const supabase = await createClient()
  const now = new Date()
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

  // commission_ledger_select: operator_id = auth.uid() OR owner del tenant.
  // Acá siempre es la propia operadora, RLS ya se encarga.
  const { data: ledger } = await supabase
    .from("commission_ledger")
    .select("id, amount, settled, sale_items(item_type, quantity, unit_price)")
    .eq("operator_id", user.id)
    .eq("period", period)
    .order("id", { ascending: false })

  const total = (ledger ?? []).reduce((sum, l) => sum + Number(l.amount), 0)
  const settled = (ledger ?? [])
    .filter((l) => l.settled)
    .reduce((sum, l) => sum + Number(l.amount), 0)
  const pending = total - settled

  return (
    <div>
      <h1>Mis comisiones</h1>
      <p style={{ color: "var(--ink-soft)" }}>Período {period}</p>

      <div className="stat-grid">
        <StatTile label="Acumulado del mes" value={formatCurrency(total)} />
        <StatTile label="Liquidado" value={formatCurrency(settled)} />
        <StatTile label="Pendiente" value={formatCurrency(pending)} />
      </div>

      <section className="card">
        <h3>Detalle</h3>
        {!ledger || ledger.length === 0 ? (
          <EmptyState
            title="Todavía no generaste comisiones este mes"
            description="Cada venta o servicio que completes con tu nombre suma acá automáticamente."
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ítem</th>
                <th>Monto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td>{l.sale_items?.item_type === "product" ? "Producto" : "Servicio"}</td>
                  <td>{formatCurrency(Number(l.amount))}</td>
                  <td>
                    <Badge tone={l.settled ? "success" : "warning"}>
                      {l.settled ? "Liquidado" : "Pendiente"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
