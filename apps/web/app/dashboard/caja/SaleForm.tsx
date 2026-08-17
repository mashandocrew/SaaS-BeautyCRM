"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash } from "@phosphor-icons/react"
import { Button, Field, Input } from "@beautycrm/ui"
import { confirmSale } from "@/lib/caja-actions"
import type {
  AppointmentCharge, CatalogItem, OperatorOption, PaymentInput, PaymentMethod, SaleItemType,
} from "@/lib/caja-types"

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Tarjeta" },
  { value: "transfer", label: "Transferencia" },
  { value: "mp", label: "Mercado Pago" },
  { value: "other", label: "Otro" },
]

type Line = {
  key: string
  item_id: string
  item_type: SaleItemType
  name: string
  price: number
  quantity: number
  operator_id: string | null
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function SaleForm({
  branchId, catalog, operators, charge,
}: {
  branchId: string
  catalog: CatalogItem[]
  operators: OperatorOption[]
  /** Turno a cobrar, si se entró con ?turno=<id>. */
  charge: AppointmentCharge | null
}) {
  const router = useRouter()

  // Sembrado en los inicializadores de useState, nunca con un useEffect: el
  // padre monta este componente con `key` por turno, así que un turno
  // distinto siempre implica una instancia nueva. Ver commit 7173ee8.
  const [lines, setLines] = useState<Line[]>(() =>
    (charge?.lines ?? []).map((l, i) => ({
      key: `charge-${i}`,
      item_id: l.item_id,
      item_type: l.item_type,
      name: charge?.preview[i]?.name ?? "Servicio",
      price: charge?.preview[i]?.price ?? 0,
      quantity: l.quantity,
      operator_id: l.operator_id,
    })),
  )
  const [payments, setPayments] = useState<PaymentInput[]>([{ method: "cash", amount: 0 }])
  const [discount, setDiscount] = useState("0")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.price * l.quantity, 0), [lines])
  const total = Math.max(0, subtotal - (Number(discount) || 0))
  const paid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const pending = total - paid

  function addItem(id: string) {
    const item = catalog.find((c) => c.id === id)
    if (!item) return
    setLines((prev) => [
      ...prev,
      {
        key: `${item.id}-${Date.now()}`,
        item_id: item.id,
        item_type: item.type,
        name: item.name,
        price: item.price,
        quantity: 1,
        operator_id: null,
      },
    ])
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await confirmSale(
      branchId,
      charge?.client_id ?? null,
      charge?.appointment_id ?? null,
      lines.map((l) => ({
        item_id: l.item_id,
        item_type: l.item_type,
        quantity: l.quantity,
        operator_id: l.operator_id,
      })),
      payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) })),
      Number(discount) || 0,
    )

    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }

    setLines([])
    setPayments([{ method: "cash", amount: 0 }])
    setDiscount("0")
    // Si veníamos de un turno, sacamos el ?turno= de la URL: ya está cobrado.
    router.replace("/dashboard/caja")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2>{charge ? `Cobrar turno — ${charge.client_name ?? "Sin cliente"}` : "Nueva venta"}</h2>
      {error ? <p className="error-banner">{error}</p> : null}

      <Field label="Agregar ítem" htmlFor="catalog-picker" hint="Servicios y productos de reventa.">
        <select
          id="catalog-picker"
          className="input"
          value=""
          onChange={(e) => {
            addItem(e.target.value)
            e.target.value = ""
          }}
        >
          <option value="">Elegí un servicio o producto...</option>
          {catalog.map((c) => (
            <option key={`${c.type}-${c.id}`} value={c.id}>
              {c.name} — {formatPrice(c.price)}
            </option>
          ))}
        </select>
      </Field>

      {lines.length === 0 ? (
        <p style={{ color: "var(--color-ink-soft)" }}>El carrito está vacío.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Ítem</th>
              <th>Cant.</th>
              <th>Precio</th>
              <th>Quién lo hizo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.name}</td>
                <td>
                  <Input
                    aria-label={`Cantidad de ${l.name}`}
                    type="number"
                    value={String(l.quantity)}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((p) => (p.key === l.key ? { ...p, quantity: Number(e.target.value) } : p)),
                      )
                    }
                  />
                </td>
                <td>{formatPrice(l.price * l.quantity)}</td>
                <td>
                  {/* Arranca vacío a propósito: vacío significa "sin
                      comisión". Asignarle una venta a alguien por descuido
                      le cambia la liquidación del mes. */}
                  <select
                    aria-label={`Quién hizo ${l.name}`}
                    className="input"
                    value={l.operator_id ?? ""}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((p) => (p.key === l.key ? { ...p, operator_id: e.target.value || null } : p)),
                      )
                    }
                  >
                    <option value="">Sin comisión</option>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Quitar ${l.name}`}
                    onClick={() => setLines((prev) => prev.filter((p) => p.key !== l.key))}
                  >
                    <Trash size={16} weight="bold" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Field label="Descuento" htmlFor="sale-discount" hint="En pesos, sobre el total. No reduce la comisión.">
        <Input id="sale-discount" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
      </Field>

      <p>
        Total: <strong className="sale-total">{formatPrice(total)}</strong>
      </p>

      <h3>Pagos</h3>
      {payments.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
          <select
            aria-label={`Medio de pago ${i + 1}`}
            className="input"
            value={p.method}
            onChange={(e) =>
              setPayments((prev) =>
                prev.map((q, j) => (i === j ? { ...q, method: e.target.value as PaymentMethod } : q)),
              )
            }
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <Input
            aria-label={`Monto del pago ${i + 1}`}
            type="number"
            value={String(p.amount)}
            onChange={(e) =>
              setPayments((prev) => prev.map((q, j) => (i === j ? { ...q, amount: Number(e.target.value) } : q)))
            }
          />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => setPayments((prev) => [...prev, { method: "card", amount: 0 }])}
      >
        <Plus size={16} weight="bold" /> Otro medio de pago
      </Button>

      <p className="sale-pending">
        {pending === 0 ? "Los pagos cierran." : `Falta asignar ${formatPrice(pending)}`}
      </p>

      <Button type="submit" disabled={loading || lines.length === 0 || pending !== 0}>
        {loading ? "Cobrando..." : "Cobrar"}
      </Button>
    </form>
  )
}
