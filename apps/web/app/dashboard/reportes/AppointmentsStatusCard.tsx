import { Card } from "@beautycrm/ui"
import type { AppointmentStatusCount } from "@/lib/reportes-types"

const STATUS_LABELS: Record<string, string> = {
  booked: "Agendados",
  in_progress: "En curso",
  done: "Completados",
  cancelled: "Cancelados",
  no_show: "No se presentó",
}

export function AppointmentsStatusCard({ counts }: { counts: AppointmentStatusCount[] }) {
  const total = counts.reduce((acc, c) => acc + c.count, 0)

  return (
    <Card>
      <h2>Turnos por estado</h2>
      {total === 0 ? (
        <p style={{ color: "var(--color-ink-soft)" }}>No hubo turnos en el rango.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Estado</th>
              <th>Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.status}>
                <td>{STATUS_LABELS[c.status] ?? c.status}</td>
                <td>{c.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
