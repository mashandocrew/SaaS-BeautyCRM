import type { Database } from "@beautycrm/supabase/types"

export type AgendaStatus = Database["public"]["Enums"]["appointment_status"]

export type AgendaServiceItem = {
  service_id: string
  name: string
  duration_minutes: number
  price_snapshot: number
}

export type AgendaAppointment = {
  id: string
  tenant_id: string
  branch_id: string
  status: AgendaStatus
  starts_at: string
  ends_at: string
  source: string
  google_event_id: string | null
  client_id: string | null
  client_name: string | null
  client_phone: string | null
  operator_id: string | null
  operator_name: string | null
  services: AgendaServiceItem[]
  total_price: number
}

export type AgendaOperator = { id: string; full_name: string | null }

export type AgendaService = { id: string; name: string; duration_minutes: number; price: number }

export type AgendaBranch = { id: string; name: string }
