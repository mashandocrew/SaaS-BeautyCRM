import { redirect } from "next/navigation"
import { createClient } from "@beautycrm/supabase/server"
import { getCurrentMembership } from "@/lib/session"
import { Badge, EmptyState } from "@beautycrm/ui"

type AppointmentRow = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  clients: { id: string; full_name: string; phone: string | null } | null
}

const STATUS_LABEL: Record<string, string> = {
  booked: "Reservado",
  confirmed: "Confirmado",
  in_progress: "En curso",
  done: "Hecho",
  no_show: "No vino",
  cancelled: "Cancelado",
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
}

export default async function MiDiaPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const supabase = await createClient()
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  // RLS ya limita esto a lo suyo si es operator (appointments_select:
  // operator_id = auth.uid() OR has_role(owner/supervisor)) — no hace
  // falta filtrar por operator_id acá, sería un parche redundante.
  const { data: appointments } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status, clients(id, full_name, phone)")
    .gte("starts_at", start.toISOString())
    .lte("starts_at", end.toISOString())
    .order("starts_at", { ascending: true })

  return (
    <div>
      <h1>Mi día</h1>
      <p style={{ color: "var(--ink-soft)" }}>
        {now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
      </p>

      {!appointments || appointments.length === 0 ? (
        <EmptyState
          title="Sin turnos hoy"
          description="Cuando te asignen un turno para hoy, va a aparecer acá."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {appointments.map((a: AppointmentRow) => (
            <div key={a.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{formatTime(a.starts_at)}</strong>
                <Badge tone={a.status === "done" ? "success" : "neutral"}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </Badge>
              </div>
              <p style={{ margin: "4px 0 0" }}>{a.clients?.full_name ?? "Cliente sin nombre"}</p>
              <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 13 }}>
                {a.clients?.phone ?? ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
