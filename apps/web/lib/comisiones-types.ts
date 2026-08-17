export type CommissionRule = {
  id: string
  name: string
  base_salary: number
  service_pct: number
  product_sale_pct: number
}

export type CommissionRuleInput = {
  name: string
  baseSalary: number
  servicePct: number
  productSalePct: number
}

/** Una persona del equipo, para asignarle una regla de comisión. */
export type TeamCommissionMember = {
  user_id: string
  name: string
  role: string
  commission_rule_id: string | null
}

/** Lo devengado (y liquidado) por una operadora en un período. */
export type OperatorPeriodTotal = {
  operator_id: string
  operator_name: string
  earned: number
  settled: number
  pending: number
}
