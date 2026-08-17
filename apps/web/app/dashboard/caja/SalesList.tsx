"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge, Button } from "@beautycrm/ui"
import { voidSale } from "@/lib/caja-actions"
import type { SaleRecord } from "@/lib/caja-types"

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia",
  mp: "Mercado Pago", other: "Otro",
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

// Timezone fijo por el mismo motivo que ClientHistoryTable.tsx: sin él, el
// server (UTC) y el browser formatean distinto y la hidratación no coincide.
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Mendoza", hour: "2-digit", minute: "2-digit",
  })
}

export function SalesList({ sales, canVoid }: { sales: SaleRecord[]; canVoid: boolean }) {
  const router = useRouter()
  const [voiding, setVoiding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleVoid(sale: SaleRecord) {
    const reason = window.prompt(
      `¿Por qué anulás esta venta de ${formatPrice(sale.total)}? El motivo queda registrado.`,
    )
    if (reason === null) return

    setError(null)
    setVoiding(sale.id)
    const result = await voidSale(sale.id, reason)
    setVoiding(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  if (sales.length === 0) {
    return <p style={{ color: "var(--color-ink-soft)" }}>Todavía no hay ventas en este turno.</p>
  }

  return (
    <>
      {error ? <p className="error-banner">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Hora</th>
            <th>Cliente</th>
            <th>Ítems</th>
            <th>Pago</th>
            <th>Total</th>
            {canVoid ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s.id}>
              <td>{formatTime(s.created_at)}</td>
              <td>{s.client_name ?? "Mostrador"}</td>
              <td>{s.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</td>
              <td>{s.payments.map((p) => METHOD_LABELS[p.method] ?? p.method).join(" + ")}</td>
              <td>
                {formatPrice(s.total)}
                {s.voided_at ? (
                  <>
                    {" "}
                    <Badge tone="danger">Anulada</Badge>
                  </>
                ) : null}
              </td>
              {canVoid ? (
                <td>
                  {s.voided_at ? (
                    <span style={{ color: "var(--color-ink-soft)" }}>{s.void_reason}</span>
                  ) : (
                    <Button variant="danger" disabled={voiding === s.id} onClick={() => handleVoid(s)}>
                      {voiding === s.id ? "Anulando..." : "Anular"}
                    </Button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
