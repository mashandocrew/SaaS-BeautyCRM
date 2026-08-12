import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { ServiceRecord } from "./service-types"

/**
 * Todos los servicios del tenant, activos e inactivos — a diferencia de
 * getActiveServices (lib/agenda-queries.ts), que filtra is_active para el
 * modal de nuevo turno. Acá el dueño necesita ver también los desactivados
 * para poder reactivarlos.
 *
 * nullsFirst: false manda los servicios sin categoría al final, que es
 * donde ServicesList renderiza el grupo "Sin categoría".
 */
export async function getServices(tenantId: string): Promise<ServiceRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("services")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("category", { nullsFirst: false })
    .order("name")

  // price es `numeric` en Postgres y supabase-js lo puede devolver como
  // string aunque types.ts lo tipe `number` — mismo Number() defensivo que
  // ya hace getActiveServices en lib/agenda-queries.ts.
  return (data ?? []).map((s) => ({ ...s, price: Number(s.price) }))
}
