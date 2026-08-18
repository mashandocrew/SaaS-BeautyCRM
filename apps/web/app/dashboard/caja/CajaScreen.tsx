"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Card, Field, Input, StatTile } from "@beautycrm/ui"
import { closeCashSession, openCashSession } from "@/lib/caja-actions"
import type {
  AppointmentCharge, CashSession, CatalogItem, OperatorOption, SaleRecord,
} from "@/lib/caja-types"
import { SaleForm } from "./SaleForm"
import { SalesList } from "./SalesList"

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", card: "Tarjeta / débito", transfer: "Transferencia",
  mp: "Mercado Pago", other: "Otro",
}

/**
 * Un total por medio de pago, no uno solo mezclado: sólo el efectivo se
 * cuenta a mano y entra en el arqueo (close_cash_session, 0013, ya lo separa
 * en la base). Tarjeta y transferencia se concilian contra el resumen del
 * banco o de Mercado Pago, nunca contra el cajón — mostrarlos junto con el
 * efectivo invitaba a mezclar los dos controles.
 */
function totalsByMethod(sales: SaleRecord[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const sale of sales) {
    if (sale.voided_at) continue
    for (const payment of sale.payments) {
      totals[payment.method] = (totals[payment.method] ?? 0) + payment.amount
    }
  }
  return totals
}

export function CajaScreen({
  branchId, session, lastClosed, sales, catalog, operators, charge, role,
}: {
  branchId: string
  /** La caja abierta, o null si está cerrada. */
  session: CashSession | null
  lastClosed: CashSession | null
  sales: SaleRecord[]
  catalog: CatalogItem[]
  operators: OperatorOption[]
  charge: AppointmentCharge | null
  role: string
}) {
  const router = useRouter()
  const [opening, setOpening] = useState("0")
  const [counted, setCounted] = useState("0")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canVoid = role === "owner"

  async function handleOpen(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const result = await openCashSession(branchId, Number(opening))
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  async function handleClose(e: FormEvent) {
    e.preventDefault()
    if (!session) return
    setError(null)
    setBusy(true)
    const result = await closeCashSession(session.id, Number(counted))
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  // --- Caja cerrada ---
  if (!session) {
    return (
      <div>
        {lastClosed ? (
          <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
            <StatTile label="Último cierre — esperado" value={formatPrice(Number(lastClosed.expected_total ?? 0))} />
            <StatTile label="Contado" value={formatPrice(Number(lastClosed.counted_total ?? 0))} />
            <StatTile label="Diferencia" value={formatPrice(Number(lastClosed.difference ?? 0))} />
          </div>
        ) : null}

        <Card>
          <h2>Abrir caja</h2>
          {error ? <p className="error-banner">{error}</p> : null}
          <form onSubmit={handleOpen} noValidate>
            <Field label="Con cuánto arrancás" htmlFor="opening-amount" hint="El efectivo que ya hay en el cajón.">
              <Input id="opening-amount" type="number" value={opening} onChange={(e) => setOpening(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy}>{busy ? "Abriendo..." : "Abrir caja"}</Button>
          </form>
        </Card>
      </div>
    )
  }

  // --- Caja abierta ---
  const byMethod = totalsByMethod(sales)
  const cashTaken = byMethod.cash ?? 0

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: "var(--space-4)" }}>
        <StatTile label="Apertura" value={formatPrice(Number(session.opening_amount))} />
        <StatTile label="Efectivo cobrado" value={formatPrice(cashTaken)} />
        <StatTile label="Ventas del turno" value={sales.filter((s) => !s.voided_at).length} />
      </div>

      {/* Un total por medio de pago: la dueña concilia tarjeta y
          transferencia contra el resumen del banco/Mercado Pago, nunca
          contra el cajón — mezclarlos en un solo número no le sirve para
          ninguno de los dos controles. */}
      {Object.keys(byMethod).length > 0 ? (
        <Card style={{ marginBottom: "var(--space-4)" }}>
          <h2>Cobrado por medio de pago</h2>
          <table>
            <thead>
              <tr>
                <th>Medio</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byMethod).map(([method, total]) => (
                <tr key={method}>
                  <td>{PAYMENT_METHOD_LABELS[method] ?? method}</td>
                  <td>{formatPrice(total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {error ? <p className="error-banner">{error}</p> : null}

      <Card style={{ marginBottom: "var(--space-4)" }}>
        {/* `key` por turno: entrar a cobrar otro turno monta una instancia
            nueva, con el carrito ya sembrado. Ver el comentario en SaleForm. */}
        <SaleForm
          key={charge?.appointment_id ?? "mostrador"}
          branchId={branchId}
          catalog={catalog}
          operators={operators}
          charge={charge}
        />
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2>Ventas del turno</h2>
        <SalesList sales={sales} canVoid={canVoid} />
      </Card>

      <Card>
        <h2>Cerrar caja</h2>
        <form onSubmit={handleClose} noValidate>
          <Field
            label="Cuánto contaste"
            htmlFor="counted-total"
            hint="Sólo el efectivo del cajón. Tarjeta y transferencia no cuentan."
          >
            <Input id="counted-total" type="number" value={counted} onChange={(e) => setCounted(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? "Cerrando..." : "Cerrar caja"}
          </Button>
        </form>
      </Card>
    </div>
  )
}
