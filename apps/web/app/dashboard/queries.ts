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
}

export type StockAlertRow = {
  item_id: string
  item_type: string
  current_stock: number
  min_alert_level: number
  branches: { tenant_id: string; name: string } | null
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

      supabase
        .from("sales")
        .select("total")
        .eq("tenant_id", tenantId)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd)
        .returns<SaleTotalRow[]>(),

      supabase
        .from("sales")
        .select("total")
        .eq("tenant_id", tenantId)
        .gte("created_at", monthStart)
        .returns<SaleTotalRow[]>(),

      supabase
        .from("inventory")
        .select("item_id, item_type, current_stock, min_alert_level, branches:branch_id(tenant_id, name)")
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

  // inventory no tiene tenant_id directo (vive en branches) — la policy de
  // RLS ya filtra por tenant vía la FK a branches, así que lo que llega acá
  // ya es sólo del tenant actual. El filtro <= min_alert_level se resuelve
  // client-side abajo comparando ambas columnas (Postgrest no compara dos
  // columnas entre sí en un solo .lte()).
  const stockAlerts = (lowStock.data ?? []).filter(
    (item: StockAlertRow) =>
      item.branches?.tenant_id === tenantId && item.current_stock <= item.min_alert_level
  )

  return {
    todayAppointments: todayAppointments.data ?? [],
    todayRevenue,
    monthRevenue,
    stockAlerts,
    monthCommissionsTotal,
  }
}
