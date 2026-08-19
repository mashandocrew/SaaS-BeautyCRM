import "server-only"
import { createClient } from "@beautycrm/supabase/server"

function startOfDayISO(d: Date) {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy.toISOString()
}

function endOfDayISO(d: Date) {
  const copy = new Date(d)
  copy.setHours(23, 59, 59, 999)
  return copy.toISOString()
}

function startOfMonthISO(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

export type AppointmentRow = {
  id: string
  starts_at: string
  status: string
  clients: { full_name: string } | null
  users: { full_name: string | null } | null
  /** "Hecho" pero sin ninguna venta no anulada asociada — se prestó el
   *  servicio y nadie lo cobró. Ver getDashboardData. */
  doneWithoutSale: boolean
}

export type StockAlertRow = {
  item_id: string
  item_type: string
  name: string
  branch_name: string
  current_stock: number
  min_alert_level: number
}

type SaleTotalRow = { total: number }
type CommissionAmountRow = { amount: number }

export async function getDashboardData(tenantId: string) {
  const supabase = await createClient()
  const now = new Date()
  const todayStart = startOfDayISO(now)
  const todayEnd = endOfDayISO(now)
  const monthStart = startOfMonthISO(now)
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

  const [todayAppointments, todaySales, monthSales, lowStock, monthCommissions] =
    await Promise.all([
      supabase
        .from("appointments")
        .select("id, starts_at, status, clients(full_name), users:operator_id(full_name)")
        .eq("tenant_id", tenantId)
        .gte("starts_at", todayStart)
        .lte("starts_at", todayEnd)
        .order("starts_at", { ascending: true })
        .returns<AppointmentRow[]>(),

      // .is("voided_at", null) en las dos: sin este filtro, una venta
      // anulada seguía sumando acá aunque Reportes (lib/reportes-queries.ts)
      // ya la excluye — dos pantallas del mismo sistema mostrando dos
      // totales de facturación distintos para el mismo período.
      supabase
        .from("sales")
        .select("total")
        .eq("tenant_id", tenantId)
        .is("voided_at", null)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd)
        .returns<SaleTotalRow[]>(),

      supabase
        .from("sales")
        .select("total")
        .eq("tenant_id", tenantId)
        .is("voided_at", null)
        .gte("created_at", monthStart)
        .returns<SaleTotalRow[]>(),

      // Contra v_inventory y no contra inventory: la vista filtra los ítems
      // eliminados (deleted_at) y ya trae below_minimum calculado con el
      // mismo criterio que usa el módulo Inventario. Leer inventory directo
      // mostraba acá ítems ya eliminados —cuya fila de inventory sobrevive
      // al borrado suave— y marcaba como bajo todo ítem con mínimo 0.
      supabase
        .from("v_inventory")
        .select("item_id, item_type, name, branch_name, current_stock, min_alert_level")
        .eq("tenant_id", tenantId)
        .eq("below_minimum", true)
        .order("current_stock", { ascending: true })
        .returns<StockAlertRow[]>(),

      supabase
        .from("commission_ledger")
        .select("amount")
        .eq("tenant_id", tenantId)
        .eq("period", period)
        .returns<CommissionAmountRow[]>(),
    ])

  const todayRevenue = (todaySales.data ?? []).reduce(
    (sum: number, s: SaleTotalRow) => sum + Number(s.total),
    0
  )
  const monthRevenue = (monthSales.data ?? []).reduce(
    (sum: number, s: SaleTotalRow) => sum + Number(s.total),
    0
  )
  const monthCommissionsTotal = (monthCommissions.data ?? []).reduce(
    (sum: number, c: CommissionAmountRow) => sum + Number(c.amount),
    0
  )

  // Sin filtro client-side: below_minimum ya resuelve en la vista la
  // comparación entre dos columnas que Postgrest no puede expresar.
  // numeric de Postgres puede llegar como string — mismo Number()
  // defensivo que hace getInventory (lib/inventory-queries.ts).
  const stockAlerts = (lowStock.data ?? []).map((item: StockAlertRow) => ({
    ...item,
    current_stock: Number(item.current_stock),
    min_alert_level: Number(item.min_alert_level),
  }))

  // Un turno "Hecho" no genera ninguna venta por sí solo — eso pasa recién
  // al cobrar desde Caja. Sin esta marca, un turno prestado y nunca cobrado
  // se ve idéntico en esta tabla a uno que sí se cobró: la dueña no tiene
  // forma de notarlo salvo yendo a reconciliar a mano contra Caja/Reportes.
  const doneIds = (todayAppointments.data ?? [])
    .filter((a) => a.status === "done")
    .map((a) => a.id)
  const paidIds = new Set<string>()
  if (doneIds.length > 0) {
    const { data: paidSales } = await supabase
      .from("sales")
      .select("appointment_id")
      .in("appointment_id", doneIds)
      .is("voided_at", null)
      .returns<{ appointment_id: string | null }[]>()
    for (const s of paidSales ?? []) {
      if (s.appointment_id) paidIds.add(s.appointment_id)
    }
  }

  return {
    todayAppointments: (todayAppointments.data ?? []).map((a) => ({
      ...a,
      doneWithoutSale: a.status === "done" && !paidIds.has(a.id),
    })),
    todayRevenue,
    monthRevenue,
    stockAlerts,
    monthCommissionsTotal,
  }
}
