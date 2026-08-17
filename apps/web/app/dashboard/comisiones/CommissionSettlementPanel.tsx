"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button, Card, EmptyState } from "@beautycrm/ui"
import { ChartLine } from "@phosphor-icons/react"
import { settlePeriod } from "@/lib/comisiones-actions"
import type { OperatorPeriodTotal } from "@/lib/comisiones-types"

function formatMoney(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function CommissionSettlementPanel({
  tenantId,
  period,
  totals,
}: {
  tenantId: string
  period: string
  totals: OperatorPeriodTotal[]
}) {
  const router = useRouter()
  const [selectedPeriod, setSelectedPeriod] = useState(period)
  const [settling, setSettling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pendingTotal = totals.reduce((acc, t) => acc + t.pending, 0)
  const hasPending = pendingTotal > 0

  function handlePeriodChange(next: string) {
    setSelectedPeriod(next)
    router.push(`/dashboard/comisiones?periodo=${next}`)
  }

  async function handleSettle() {
    if (!window.confirm(`¿Liquidar el período ${selectedPeriod}? Todo lo pendiente pasa a liquidado.`)) return

    setError(null)
    setSettling(true)
    const result = await settlePeriod(tenantId, selectedPeriod)
    setSettling(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <h2>Liquidación mensual</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <label htmlFor="settlement-period">Período</label>
          <input
            id="settlement-period"
            type="month"
            value={selectedPeriod}
            onChange={(e) => handlePeriodChange(e.target.value)}
          />
        </div>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {totals.length === 0 ? (
        <EmptyState
          icon={<ChartLine size={32} />}
          title="Nada devengado este período"
          description="Cuando el equipo cobre turnos o ventas con comisión, van a aparecer acá."
        />
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Operadora</th>
                <th>Devengado</th>
                <th>Liquidado</th>
                <th>Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.operator_id}>
                  <td>{t.operator_name}</td>
                  <td>{formatMoney(t.earned)}</td>
                  <td>{formatMoney(t.settled)}</td>
                  <td>{formatMoney(t.pending)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Button onClick={handleSettle} disabled={!hasPending || settling} style={{ marginTop: "var(--space-4)" }}>
            {settling ? "Liquidando..." : `Liquidar ${selectedPeriod}`}
          </Button>
        </>
      )}
    </Card>
  )
}
