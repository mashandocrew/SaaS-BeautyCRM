import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type {
  AppointmentCharge, CashSession, CatalogItem, OperatorOption, PaymentMethod, SaleRecord,
} from "./caja-types"

/** La caja abierta de la sucursal, o null. Hay a lo sumo una (índice único). */
export async function getOpenSession(branchId: string): Promise<CashSession | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("cash_sessions")
    .select("*")
    .eq("branch_id", branchId)
    .is("closed_at", null)
    .maybeSingle()
  return data ?? null
}

/** El último cierre, para mostrar el arqueo cuando no hay caja abierta. */
export async function getLastClosedSession(branchId: string): Promise<CashSession | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("cash_sessions")
    .select("*")
    .eq("branch_id", branchId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

type SaleJoin = {
  id: string
  total: number
  discount: number
  created_at: string
  voided_at: string | null
  void_reason: string | null
  clients: { full_name: string } | null
  sale_items: { item_type: string; item_id: string; quantity: number; unit_price: number }[]
  payments: { method: string; amount: number }[]
}

/**
 * Las ventas de una sesión, de la más nueva a la más vieja.
 *
 * sale_items.item_id es polimórfico y no tiene FK, así que el nombre del ítem
 * no se puede traer con un join de Postgrest: se resuelve con dos consultas
 * más y un mapa. Mismo criterio que v_inventory en 0012.
 */
export async function getSessionSales(sessionId: string): Promise<SaleRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("sales")
    .select(
      "id, total, discount, created_at, voided_at, void_reason, clients(full_name), sale_items(item_type, item_id, quantity, unit_price), payments(method, amount)",
    )
    .eq("cash_session_id", sessionId)
    .order("created_at", { ascending: false })
    .returns<SaleJoin[]>()

  const sales = data ?? []
  const serviceIds = [
    ...new Set(sales.flatMap((s) => s.sale_items.filter((i) => i.item_type === "service").map((i) => i.item_id))),
  ]
  const productIds = [
    ...new Set(sales.flatMap((s) => s.sale_items.filter((i) => i.item_type === "product").map((i) => i.item_id))),
  ]

  const names = new Map<string, string>()
  if (serviceIds.length > 0) {
    const { data: rows } = await supabase.from("services").select("id, name").in("id", serviceIds)
    for (const r of rows ?? []) names.set(r.id, r.name)
  }
  if (productIds.length > 0) {
    const { data: rows } = await supabase.from("retail_products").select("id, name").in("id", productIds)
    for (const r of rows ?? []) names.set(r.id, r.name)
  }

  return sales.map((s) => ({
    id: s.id,
    total: Number(s.total),
    discount: Number(s.discount),
    created_at: s.created_at,
    voided_at: s.voided_at,
    void_reason: s.void_reason,
    client_name: s.clients?.full_name ?? null,
    items: s.sale_items.map((i) => ({
      name: names.get(i.item_id) ?? "Ítem eliminado",
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
    })),
    payments: s.payments.map((p) => ({ method: p.method as PaymentMethod, amount: Number(p.amount) })),
  }))
}

/** Todo lo vendible: servicios activos y productos no eliminados. */
export async function getCatalog(tenantId: string): Promise<CatalogItem[]> {
  const supabase = await createClient()
  const [services, products] = await Promise.all([
    supabase.from("services").select("id, name, price").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
    supabase
      .from("retail_products")
      .select("id, name, sale_price")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("name"),
  ])

  return [
    ...(services.data ?? []).map((s) => ({
      id: s.id, type: "service" as const, name: s.name, price: Number(s.price),
    })),
    ...(products.data ?? []).map((p) => ({
      id: p.id, type: "product" as const, name: p.name, price: Number(p.sale_price),
    })),
  ]
}

/** Quiénes pueden llevarse la comisión de una línea. */
export async function getOperators(tenantId: string): Promise<OperatorOption[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("memberships")
    .select("user_id, users(full_name)")
    .eq("tenant_id", tenantId)
    .returns<{ user_id: string; users: { full_name: string | null } | null }[]>()

  return (data ?? []).map((m) => ({ id: m.user_id, name: m.users?.full_name ?? "Sin nombre" }))
}

/**
 * Un turno listo para cobrar. `preview` usa el price_snapshot cotizado al
 * agendar, que es también el que va a cobrar el RPC.
 */
export async function getAppointmentCharge(appointmentId: string): Promise<AppointmentCharge | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("appointments")
    .select(
      "id, client_id, operator_id, clients(full_name), appointment_services(service_id, price_snapshot, services(name))",
    )
    .eq("id", appointmentId)
    .maybeSingle()
    .returns<{
      id: string
      client_id: string | null
      operator_id: string | null
      clients: { full_name: string } | null
      appointment_services: { service_id: string; price_snapshot: number; services: { name: string } | null }[]
    } | null>()

  if (!data) return null

  return {
    appointment_id: data.id,
    client_id: data.client_id,
    client_name: data.clients?.full_name ?? null,
    operator_id: data.operator_id,
    lines: data.appointment_services.map((a) => ({
      item_id: a.service_id,
      item_type: "service" as const,
      quantity: 1,
      operator_id: data.operator_id,
    })),
    preview: data.appointment_services.map((a) => ({
      name: a.services?.name ?? "Servicio",
      price: Number(a.price_snapshot),
    })),
  }
}
