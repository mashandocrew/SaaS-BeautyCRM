export type SalesSummary = {
  total: number
  count: number
  averageTicket: number
}

export type TopItem = {
  item_id: string
  name: string
  amount: number
  quantity: number
}

export type AppointmentStatusCount = {
  status: string
  count: number
}

export type SalesExportRow = {
  date: string
  item_name: string
  item_type: string
  quantity: number
  unit_price: number
  operator_name: string | null
  payment_methods: string
}

export type ReportesFilters = {
  from: string
  to: string
  branchId: string | null
}
