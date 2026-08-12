import type { Tables } from "@beautycrm/supabase/types"

export type ServiceRecord = Tables<"services">

/**
 * Forma que consume el form. camelCase y sin `tenant_id` a propósito:
 * el tenant lo pone la server action desde la sesión, nunca el cliente —
 * mismo criterio que ClientInput en lib/client-types.ts / client-actions.ts.
 */
export type ServiceInput = {
  name: string
  durationMinutes: number
  price: number
  category: string | null
  isActive: boolean
}
