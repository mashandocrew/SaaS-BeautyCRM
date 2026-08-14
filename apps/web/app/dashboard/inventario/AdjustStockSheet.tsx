"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { adjustStock, setMinAlertLevel } from "@/lib/inventory-actions"
import type { AdjustmentKind, InventoryItem, InventoryMovement } from "@/lib/inventory-types"

const KINDS: { value: AdjustmentKind; label: string; amountLabel: string; hint: string }[] = [
  { value: "compra",   label: "Compra",           amountLabel: "Cantidad que entró",  hint: "Suma al stock." },
  { value: "rotura",   label: "Rotura o pérdida", amountLabel: "Cantidad que se perdió", hint: "Resta del stock." },
  { value: "recuento", label: "Recuento",         amountLabel: "Cuánto contaste",     hint: "Es el total que hay, no la diferencia." },
  { value: "ajuste",   label: "Otro ajuste",      amountLabel: "Cantidad (con signo)", hint: "Usá un número negativo para restar." },
]

const REASON_LABELS: Record<string, string> = {
  compra: "Compra",
  rotura: "Rotura o pérdida",
  recuento: "Recuento",
  ajuste: "Ajuste",
  venta: "Venta",
}

// Timezone fijo por el mismo motivo que ClientHistoryTable.tsx: sin él,
// toLocaleString usa el timezone del entorno donde corre — UTC en el server,
// el del sistema en el browser — y las dos pasadas del render no coinciden.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Mendoza" })
}

export function AdjustStockSheet({
  open, onClose, branchId, item, movements,
}: {
  open: boolean
  onClose: () => void
  branchId: string
  item: InventoryItem
  movements: InventoryMovement[]
}) {
  const router = useRouter()
  // Mismo criterio de siembra que ItemFormSheet: sin useEffect, con el
  // padre montando por `key`.
  const [kind, setKind] = useState<AdjustmentKind>("compra")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minLevel, setMinLevel] = useState(String(item.min_alert_level))
  const [savingMin, setSavingMin] = useState(false)
  const [minError, setMinError] = useState<string | null>(null)

  const selected = KINDS.find((k) => k.value === kind) ?? KINDS[0]

  // El mínimo va en su propio form y no en el de movimientos: no mueve
  // stock, así que no genera un movimiento — y mezclarlo obligaría a
  // registrar un ajuste falso sólo para cambiar el nivel de aviso.
  async function handleSaveMinimum(e: FormEvent) {
    e.preventDefault()
    setMinError(null)
    setSavingMin(true)

    const result = await setMinAlertLevel(branchId, item.item_id, item.item_type, Number(minLevel))

    setSavingMin(false)
    if (!result.ok) {
      setMinError(result.error)
      return
    }
    router.refresh()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await adjustStock(
      branchId, item.item_id, item.item_type, kind, Number(amount), note.trim() || null,
    )

    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Ajustar stock — ${item.name}`} side="right">
      <form onSubmit={handleSubmit} noValidate>
        {error ? <p className="error-banner">{error}</p> : null}

        <p style={{ color: "var(--color-ink-soft)" }}>Stock actual: {item.current_stock}</p>

        <Field label="Tipo de movimiento" htmlFor="adjust-kind">
          <select
            id="adjust-kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as AdjustmentKind)}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </Field>

        <Field label={selected.amountLabel} htmlFor="adjust-amount" hint={selected.hint}>
          <Input
            id="adjust-amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>

        <Field label="Nota" htmlFor="adjust-note" hint="Opcional. Por ejemplo: proveedor, motivo.">
          <Input id="adjust-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Registrando..." : "Registrar movimiento"}
        </Button>
      </form>

      <form onSubmit={handleSaveMinimum} noValidate style={{ marginTop: "var(--space-6)" }}>
        <h3>Aviso de stock bajo</h3>
        {minError ? <p className="error-banner">{minError}</p> : null}
        <Field
          label="Avisarme cuando baje de"
          htmlFor="min-alert-level"
          hint="En 0 no te avisa nunca."
        >
          <Input
            id="min-alert-level"
            type="number"
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={savingMin}>
          {savingMin ? "Guardando..." : "Guardar mínimo"}
        </Button>
      </form>

      <h3 style={{ marginTop: "var(--space-6)" }}>Últimos movimientos</h3>
      {movements.length === 0 ? (
        <p style={{ color: "var(--color-ink-soft)" }}>Todavía no hay movimientos de este ítem.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Motivo</th>
              <th>Cambio</th>
              <th>Quedó en</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td>{formatDate(m.created_at)}</td>
                <td>{REASON_LABELS[m.reason] ?? m.reason}{m.note ? ` — ${m.note}` : ""}</td>
                <td>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                <td>{m.resulting_stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Sheet>
  )
}
