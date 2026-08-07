import { redirect } from "next/navigation"
import { createClient } from "@beautycrm/supabase/server"
import { getCurrentMembership } from "@/lib/session"
import { EmptyState } from "@beautycrm/ui"
import { NoteForm } from "./NoteForm"

export default async function MiClientePage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const supabase = await createClient()

  // "La persona que está por atender": el próximo turno agendado desde
  // ahora en adelante (o el que esté en curso). RLS ya limita a lo suyo.
  const { data: nextAppointment } = await supabase
    .from("appointments")
    .select("id, starts_at, status, clients(id, full_name, phone, birthday, notes)")
    .in("status", ["booked", "confirmed", "in_progress"])
    .gte("starts_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!nextAppointment || !nextAppointment.clients) {
    return (
      <div>
        <h1>Mi cliente</h1>
        <EmptyState
          title="Sin próximo turno"
          description="Cuando tengas un turno agendado, vas a ver acá el historial de esa persona."
        />
      </div>
    )
  }

  const client = nextAppointment.clients

  const { data: history } = await supabase
    .from("client_history")
    .select("id, performed_at, technical_notes, services(name)")
    .eq("client_id", client.id)
    .order("performed_at", { ascending: false })
    .limit(10)

  return (
    <div>
      <h1>Mi cliente</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 4px" }}>{client.full_name}</h2>
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>{client.phone}</p>
        {client.notes ? <p style={{ marginTop: 8 }}>{client.notes}</p> : null}
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <h3>Historial</h3>
        {!history || history.length === 0 ? (
          <EmptyState
            title="Sin historial todavía"
            description="Las notas técnicas que cargues acá van a quedar guardadas para la próxima vez."
          />
        ) : (
          <ul style={{ paddingLeft: 16 }}>
            {history.map((h) => (
              <li key={h.id} style={{ marginBottom: 8 }}>
                <strong>{new Date(h.performed_at).toLocaleDateString("es-AR")}</strong>
                {h.services?.name ? ` — ${h.services.name}` : ""}
                {h.technical_notes ? <p style={{ margin: "2px 0 0" }}>{h.technical_notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>Agregar nota</h3>
        <NoteForm appointmentId={nextAppointment.id} />
      </section>
    </div>
  )
}
