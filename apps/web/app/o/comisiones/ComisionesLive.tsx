"use client"

import { useEffect, useState } from "react"
import { Wallet } from "@phosphor-icons/react"
import { createClient } from "@beautycrm/supabase/client"
import { StatTile, EmptyState, Badge } from "@beautycrm/ui"

type LedgerRow = {
  id: string
  amount: number
  settled: boolean
  sale_items: { item_type: "product" | "service"; quantity: number; unit_price: number } | null
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function ComisionesLive({
  initialLedger,
  operatorId,
  period,
}: {
  initialLedger: LedgerRow[]
  operatorId: string
  period: string
}) {
  const [ledger, setLedger] = useState<LedgerRow[]>(initialLedger)

  useEffect(() => {
    const supabase = createClient()

    async function refetch() {
      const { data } = await supabase
        .from("commission_ledger")
        .select("id, amount, settled, sale_items(item_type, quantity, unit_price)")
        .eq("operator_id", operatorId)
        .eq("period", period)
        .order("id", { ascending: false })
      if (data) setLedger(data as LedgerRow[])
    }

    const channel = supabase
      .channel(`commission_ledger:${operatorId}:${period}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "commission_ledger",
          filter: `operator_id=eq.${operatorId}`,
        },
        () => {
          // El payload de postgres_changes no trae el join a sale_items,
          // así que ante cualquier cambio volvemos a traer el período
          // completo. El volumen por operadora es bajo (un salón chico),
          // no hace falta mergear a mano fila por fila.
          refetch()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [operatorId, period])

  const total = ledger.reduce((sum, l) => sum + Number(l.amount), 0)
  const settled = ledger.filter((l) => l.settled).reduce((sum, l) => sum + Number(l.amount), 0)
  const pending = total - settled

  return (
    <>
      <div className="stat-grid">
        <StatTile label="Acumulado del mes" value={formatCurrency(total)} />
        <StatTile label="Liquidado" value={formatCurrency(settled)} />
        <StatTile label="Pendiente" value={formatCurrency(pending)} />
      </div>

      <section className="card">
        <h3>Detalle</h3>
        {ledger.length === 0 ? (
          <EmptyState
            icon={<Wallet size={24} weight="regular" />}
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
    </>
  )
}
