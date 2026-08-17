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
  const cashTaken = sales
    .filter((s) => !s.voided_at)
    .flatMap((s) => s.payments)
    .filter((p) => p.method === "cash")
    .reduce((sum, p) => sum + p.amount, 0)

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <StatTile label="Apertura" value={formatPrice(Number(session.opening_amount))} />
        <StatTile label="Efectivo cobrado" value={formatPrice(cashTaken)} />
        <StatTile label="Ventas del turno" value={sales.filter((s) => !s.voided_at).length} />
      </div>

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
