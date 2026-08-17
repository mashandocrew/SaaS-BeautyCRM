import { Card } from "@beautycrm/ui"
import type { SalesSummary } from "@/lib/reportes-types"

function formatMoney(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p style={{ color: "var(--color-ink-soft)", margin: 0 }}>{label}</p>
      <p style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>{value}</p>
    </Card>
  )
}

export function ReportesSummary({ summary, inventoryValuation }: { summary: SalesSummary; inventoryValuation: number | null }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "var(--space-3)",
        marginBottom: "var(--space-4)",
      }}
    >
      <Kpi label="Total vendido" value={formatMoney(summary.total)} />
      <Kpi label="Ventas" value={String(summary.count)} />
      <Kpi label="Ticket promedio" value={formatMoney(summary.averageTicket)} />
      {inventoryValuation !== null ? <Kpi label="Inventario valorizado" value={formatMoney(inventoryValuation)} /> : null}
    </div>
  )
}
