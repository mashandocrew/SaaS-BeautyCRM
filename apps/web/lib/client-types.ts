import type { Tables } from "@beautycrm/supabase/types"

export type ClientRecord = Tables<"clients">

export type ClientHistoryEntry = {
  id: string
  appointment_id: string | null
  service_id: string | null
  service_name: string | null
  operator_id: string | null
  operator_name: string | null
  branch_id: string | null
  branch_name: string | null
  performed_at: string
  technical_notes: string | null
}

export type ClientSummary = {
  visitCount: number
  lastVisitAt: string | null
}

export type ClientDetail = {
  client: ClientRecord
  history: ClientHistoryEntry[]
  summary: ClientSummary
}
