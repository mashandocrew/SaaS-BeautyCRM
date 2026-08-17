import { Card, EmptyState } from "@beautycrm/ui"
import { ChartBar } from "@phosphor-icons/react"
import type { TopItem } from "@/lib/reportes-types"

function formatMoney(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function TopItemsTable({ title, items }: { title: string; items: TopItem[] }) {
  return (
    <Card>
      <h2>{title}</h2>
      {items.length === 0 ? (
        <EmptyState icon={<ChartBar size={32} />} title="Nada vendido en el rango" description="Probá con otras fechas." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Cantidad</th>
              <th>Monto</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.item_id}>
                <td>{it.name}</td>
                <td>{it.quantity}</td>
                <td>{formatMoney(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
