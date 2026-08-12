import { redirect } from "next/navigation"
import { CalendarBlank } from "@phosphor-icons/react/dist/ssr"
import { EmptyState } from "@beautycrm/ui"
import { getCurrentMembership } from "@/lib/session"
import { getAgendaAppointments } from "@/lib/agenda-queries"
import { MiDiaList } from "./MiDiaList"

export default async function MiDiaPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  // setHours(0/23,...) corre en el timezone del proceso Node (TZ), no en
  // el del tenant — depende de que TZ esté fijado a America/Argentina/Mendoza
  // en next.config.js (ver comentario ahí). Sin eso, en un host que usa
  // UTC por default esta ventana queda corrida ~3hs respecto al horario
  // real del negocio (ART) y "Mi día" muestra/esconde turnos equivocados.
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  // RLS ya limita esto a lo suyo si es operator (appointments_select) —
  // filtramos operator_id igual, de forma explícita, para que la query
  // quede clara y acotada.
  const appointments = await getAgendaAppointments(
    membership.tenant_id,
    start.toISOString(),
    end.toISOString(),
    { operatorId: user.id }
  )

  return (
    <div>
      <h1>Mi día</h1>
      <p style={{ color: "var(--color-ink-soft)" }}>
        {now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
      </p>

      {appointments.length === 0 ? (
        <EmptyState
          icon={<CalendarBlank size={24} weight="regular" />}
          title="Sin turnos hoy"
          description="Cuando te asignen un turno para hoy, va a aparecer acá."
        />
      ) : (
        <MiDiaList tenantId={membership.tenant_id} initialAppointments={appointments} />
      )}
    </div>
  )
}
