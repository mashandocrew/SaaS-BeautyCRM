import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { BomLine, ServiceRecord, SupplyOption } from "./service-types"

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
    // Los eliminados siguen en la tabla para que el historial conserve el
    // nombre y el precio del servicio — ver migrations/0011.
    .is("deleted_at", null)
    .order("category", { nullsFirst: false })
    .order("name")

  // price es `numeric` en Postgres y supabase-js lo puede devolver como
  // string aunque types.ts lo tipe `number` — mismo Number() defensivo que
  // ya hace getActiveServices en lib/agenda-queries.ts.
  return (data ?? []).map((s) => ({ ...s, price: Number(s.price) }))
}

/** Los insumos que se pueden poner en un BOM. */
export async function getSupplyOptions(tenantId: string): Promise<SupplyOption[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("supplies")
    .select("id, name, unit")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("name")

  return (data ?? []).map((s) => ({ id: s.id, name: s.name, unit: s.unit }))
}

/**
 * El BOM de todos los servicios del tenant, indexado por service_id.
 *
 * Se traen todos de una y no uno por servicio: el Sheet de edición se monta
 * con los datos ya en mano, y a esta escala (decenas de servicios) es una
 * sola consulta contra la PK de service_supplies.
 */
export async function getServiceBoms(tenantId: string): Promise<Record<string, BomLine[]>> {
  const supabase = await createClient()
  const { data: services } = await supabase.from("services").select("id").eq("tenant_id", tenantId)
  const ids = (services ?? []).map((s) => s.id)
  if (ids.length === 0) return {}

  const { data } = await supabase
    .from("service_supplies")
    .select("service_id, supply_id, quantity_consumed")
    .in("service_id", ids)

  const byService: Record<string, BomLine[]> = {}
  for (const row of data ?? []) {
    const lines = byService[row.service_id] ?? []
    lines.push({ supply_id: row.supply_id, quantity_consumed: Number(row.quantity_consumed) })
    byService[row.service_id] = lines
  }
  return byService
}
