"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { CommissionRule, CommissionRuleInput } from "./comisiones-types"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

function validateInput(input: CommissionRuleInput): string | null {
  if (!input.name.trim()) return "El nombre es obligatorio."
  if (!Number.isFinite(input.baseSalary) || input.baseSalary < 0) return "El salario base no puede ser negativo."
  if (!Number.isFinite(input.servicePct) || input.servicePct < 0 || input.servicePct > 100) {
    return "El % de servicio tiene que estar entre 0 y 100."
  }
  if (!Number.isFinite(input.productSalePct) || input.productSalePct < 0 || input.productSalePct > 100) {
    return "El % de producto tiene que estar entre 0 y 100."
  }
  return null
}

export async function createCommissionRule(
  tenantId: string,
  input: CommissionRuleInput,
): Promise<ActionResult<CommissionRule>> {
  const invalid = validateInput(input)
  if (invalid) return { ok: false, error: invalid }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("commission_rules")
    .insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      base_salary: input.baseSalary,
      service_pct: input.servicePct,
      product_sale_pct: input.productSalePct,
    })
    .select("id, name, base_salary, service_pct, product_sale_pct")
    .single()

  if (error || !data) {
    return { ok: false, error: "No pudimos crear la regla. Puede que no tengas permiso.", code: error?.code }
  }

  revalidatePath("/dashboard/comisiones")
  return {
    ok: true,
    data: { ...data, base_salary: Number(data.base_salary), service_pct: Number(data.service_pct), product_sale_pct: Number(data.product_sale_pct) },
  }
}

export async function updateCommissionRule(
  ruleId: string,
  input: CommissionRuleInput,
): Promise<ActionResult<CommissionRule>> {
  const invalid = validateInput(input)
  if (invalid) return { ok: false, error: invalid }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("commission_rules")
    .update({
      name: input.name.trim(),
      base_salary: input.baseSalary,
      service_pct: input.servicePct,
      product_sale_pct: input.productSalePct,
    })
    .eq("id", ruleId)
    .select("id, name, base_salary, service_pct, product_sale_pct")
    .maybeSingle()

  if (error || !data) {
    return { ok: false, error: "No pudimos actualizar la regla. Puede que no tengas permiso.", code: error?.code }
  }

  revalidatePath("/dashboard/comisiones")
  return {
    ok: true,
    data: { ...data, base_salary: Number(data.base_salary), service_pct: Number(data.service_pct), product_sale_pct: Number(data.product_sale_pct) },
  }
}

/**
 * Borra una regla. Si alguna membresía la tiene asignada, la FK
 * (memberships.commission_rule_id) lo rechaza — a propósito: soltar la
 * asignación en silencio dejaría a alguien sin comisión sin que nadie lo note.
 */
export async function deleteCommissionRule(ruleId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("commission_rules").delete().eq("id", ruleId)

  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "Hay gente del equipo con esta regla asignada. Reasignalos antes de borrarla.", code: error.code }
    }
    return { ok: false, error: "No pudimos eliminar la regla. Puede que no tengas permiso.", code: error.code }
  }

  revalidatePath("/dashboard/comisiones")
  return { ok: true, data: undefined }
}

export async function assignCommissionRule(userId: string, ruleId: string | null): Promise<ActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("memberships")
    .update({ commission_rule_id: ruleId })
    .eq("user_id", userId)
    .select("id")
    .maybeSingle()

  if (error || !data) {
    return { ok: false, error: "No pudimos asignar la regla. Puede que no tengas permiso.", code: error?.code }
  }

  revalidatePath("/dashboard/comisiones")
  return { ok: true, data: undefined }
}

/**
 * Liquida todo lo pendiente de un período de una. commission_ledger no
 * expone update: el único camino es este RPC, owner-only. Ver migrations/0016.
 */
export async function settlePeriod(tenantId: string, period: string): Promise<ActionResult<number>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("settle_commission_period", {
    p_tenant_id: tenantId,
    p_period: period,
  })

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "Solo la dueña puede liquidar un período.", code: error.code }
    }
    return { ok: false, error: "No pudimos liquidar el período.", code: error.code }
  }

  revalidatePath("/dashboard/comisiones")
  return { ok: true, data: data ?? 0 }
}
