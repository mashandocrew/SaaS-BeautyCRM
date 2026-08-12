import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { ClientDetail, ClientHistoryEntry, ClientRecord } from "./client-types"

export async function getClients(tenantId: string): Promise<ClientRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase.from("clients").select("*").eq("tenant_id", tenantId).order("full_name")

  return data ?? []
}

export async function getClientDetail(tenantId: string, clientId: string): Promise<ClientDetail | null> {
  const supabase = await createClient()

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", clientId)
    .maybeSingle()

  if (!client) return null

  const { data: historyRows } = await supabase
    .from("v_client_history")
    .select(
      "id, appointment_id, service_id, service_name, operator_id, operator_name, branch_id, branch_name, performed_at, technical_notes"
    )
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .order("performed_at", { ascending: false })
    .returns<ClientHistoryEntry[]>()

  const history = historyRows ?? []

  // "Visitas" cuenta appointment_id DISTINTOS, no filas crudas: un turno
  // con 2 servicios genera 2 filas en client_history (una por servicio),
  // y contarlas tal cual infla la cifra respecto a lo que el dueño espera
  // ver como "cuántas veces vino". Las filas con appointment_id NULL son
  // notas sueltas de la operadora (no turnos reales) y no cuentan como
  // visita — mismo filtro que usamos abajo para "última visita", para que
  // ambos StatTile coincidan en qué es "una visita".
  const realVisits = history.filter((h) => h.appointment_id !== null)
  const distinctAppointments = new Set(realVisits.map((h) => h.appointment_id))

  return {
    client,
    history,
    summary: {
      visitCount: distinctAppointments.size,
      // history ya viene ordenado por performed_at desc (ver query arriba),
      // así que realVisits[0] es la fila de turno real más reciente.
      lastVisitAt: realVisits.length > 0 ? realVisits[0].performed_at : null,
    },
  }
}
