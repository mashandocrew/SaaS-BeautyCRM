import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type {
  AppointmentStatusCount, ReportesFilters, SalesExportRow, SalesSummary, TopItem,
} from "./reportes-types"

/**
 * Trae las ventas no anuladas del rango/sucursal, ya resueltas en el
 * cliente de Supabase pasado (para que el caller controle qué columnas
 * necesita sin repetir el filtro base en cada función).
 */
async function baseSales(supabase: Awaited<ReturnType<typeof createClient>>, tenantId: string, filters: ReportesFilters) {
  let query = supabase
    .from("sales")
    .select("id, total, created_at, branch_id")
    .eq("tenant_id", tenantId)
    .is("voided_at", null)
    .gte("created_at", filters.from)
    .lt("created_at", filters.to)

  if (filters.branchId) query = query.eq("branch_id", filters.branchId)

  const { data } = await query
  return data ?? []
}

export async function getSalesSummary(tenantId: string, filters: ReportesFilters): Promise<SalesSummary> {
  const supabase = await createClient()
  const sales = await baseSales(supabase, tenantId, filters)

  const total = sales.reduce((acc, s) => acc + Number(s.total), 0)
  const count = sales.length
  return { total, count, averageTicket: count > 0 ? total / count : 0 }
}

/** Top 5 servicios y top 5 productos por monto vendido en el rango. */
export async function getTopItems(
  tenantId: string,
  filters: ReportesFilters,
): Promise<{ services: TopItem[]; products: TopItem[] }> {
  const supabase = await createClient()
  const sales = await baseSales(supabase, tenantId, filters)
  const saleIds = sales.map((s) => s.id)
  if (saleIds.length === 0) return { services: [], products: [] }

  const { data: items } = await supabase
    .from("sale_items")
    .select("item_id, item_type, quantity, unit_price")
    .in("sale_id", saleIds)

  const totals = new Map<string, { item_id: string; item_type: string; amount: number; quantity: number }>()
  for (const it of items ?? []) {
    const key = `${it.item_type}:${it.item_id}`
    const current = totals.get(key) ?? { item_id: it.item_id, item_type: it.item_type, amount: 0, quantity: 0 }
    current.amount += Number(it.unit_price) * Number(it.quantity)
    current.quantity += Number(it.quantity)
    totals.set(key, current)
  }

  const serviceIds = Array.from(totals.values()).filter((t) => t.item_type === "service").map((t) => t.item_id)
  const productIds = Array.from(totals.values()).filter((t) => t.item_type === "product").map((t) => t.item_id)

  const [{ data: services }, { data: products }] = await Promise.all([
    serviceIds.length > 0
      ? supabase.from("services").select("id, name").in("id", serviceIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    productIds.length > 0
      ? supabase.from("retail_products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const serviceNames = new Map((services ?? []).map((s) => [s.id, s.name]))
  const productNames = new Map((products ?? []).map((p) => [p.id, p.name]))

  const toTopItem = (t: { item_id: string; amount: number; quantity: number }, names: Map<string, string>): TopItem => ({
    item_id: t.item_id,
    name: names.get(t.item_id) ?? "Ítem eliminado",
    amount: t.amount,
    quantity: t.quantity,
  })

  const services5 = Array.from(totals.values())
    .filter((t) => t.item_type === "service")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((t) => toTopItem(t, serviceNames))

  const products5 = Array.from(totals.values())
    .filter((t) => t.item_type === "product")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((t) => toTopItem(t, productNames))

  return { services: services5, products: products5 }
}

export async function getAppointmentsByStatus(
  tenantId: string,
  filters: ReportesFilters,
): Promise<AppointmentStatusCount[]> {
  const supabase = await createClient()
  let query = supabase
    .from("appointments")
    .select("status")
    .eq("tenant_id", tenantId)
    .gte("starts_at", filters.from)
    .lt("starts_at", filters.to)

  if (filters.branchId) query = query.eq("branch_id", filters.branchId)

  const { data } = await query
  const counts = new Map<string, number>()
  for (const a of data ?? []) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)

  return Array.from(counts.entries()).map(([status, count]) => ({ status, count }))
}

/**
 * Σ current_stock × cost sobre el inventario actual (sin rango: es una
 * foto). Devuelve null si el rol no puede ver costos — inventory_costs
 * (0015) rechaza con 42501, y acá se traduce a "no mostrar la tarjeta" en
 * vez de romper el resto de la página.
 */
export async function getInventoryValuation(tenantId: string): Promise<number | null> {
  const supabase = await createClient()
  const [{ data: inventory }, { data: costs, error: costsError }] = await Promise.all([
    supabase.from("v_inventory").select("item_id, current_stock").eq("tenant_id", tenantId),
    supabase.rpc("inventory_costs", { p_tenant_id: tenantId }),
  ])

  if (costsError) return null

  const costByItem = new Map((costs ?? []).map((c: { item_id: string; cost: number }) => [c.item_id, Number(c.cost)]))
  return (inventory ?? []).reduce((acc, row) => {
    const cost = row.item_id ? costByItem.get(row.item_id) : undefined
    if (cost === undefined || row.item_id === null) return acc
    return acc + cost * Number(row.current_stock)
  }, 0)
}

export async function getSalesDetailForExport(tenantId: string, filters: ReportesFilters): Promise<SalesExportRow[]> {
  const supabase = await createClient()
  const sales = await baseSales(supabase, tenantId, filters)
  const saleIds = sales.map((s) => s.id)
  if (saleIds.length === 0) return []

  const saleDates = new Map(sales.map((s) => [s.id, s.created_at]))

  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase
      .from("sale_items")
      .select("sale_id, item_id, item_type, quantity, unit_price, operator_id, users(full_name)")
      .in("sale_id", saleIds)
      .returns<
        {
          sale_id: string
          item_id: string
          item_type: string
          quantity: number
          unit_price: number
          operator_id: string | null
          users: { full_name: string | null } | null
        }[]
      >(),
    supabase.from("payments").select("sale_id, method").in("sale_id", saleIds),
  ])

  const paymentsBySale = new Map<string, string[]>()
  for (const p of payments ?? []) {
    const list = paymentsBySale.get(p.sale_id) ?? []
    list.push(p.method)
    paymentsBySale.set(p.sale_id, list)
  }

  const serviceIds = (items ?? []).filter((i) => i.item_type === "service").map((i) => i.item_id)
  const productIds = (items ?? []).filter((i) => i.item_type === "product").map((i) => i.item_id)
  const [{ data: services }, { data: products }] = await Promise.all([
    serviceIds.length > 0
      ? supabase.from("services").select("id, name").in("id", serviceIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    productIds.length > 0
      ? supabase.from("retail_products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const names = new Map([...(services ?? []), ...(products ?? [])].map((r) => [r.id, r.name]))

  return (items ?? []).map((it) => ({
    date: saleDates.get(it.sale_id) ?? "",
    item_name: names.get(it.item_id) ?? "Ítem eliminado",
    item_type: it.item_type,
    quantity: Number(it.quantity),
    unit_price: Number(it.unit_price),
    operator_name: it.users?.full_name ?? null,
    payment_methods: (paymentsBySale.get(it.sale_id) ?? []).join(" + "),
  }))
}
