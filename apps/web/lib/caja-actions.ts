"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { PaymentInput, SaleLineInput } from "./caja-types"

// Declarado local en vez de importado de otro módulo: cada módulo declara
// el suyo (inventory-actions.ts y service-actions.ts hacen lo mismo).
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

// Revalidar también /dashboard y /dashboard/inventario: el Panel muestra la
// facturación del día y las alertas de stock, e Inventario el saldo, y una
// venta mueve las tres cosas.
function revalidateCaja() {
  revalidatePath("/dashboard/caja")
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/inventario")
}

/**
 * Los RPC de 0013 levantan errores de dominio con `raise ... using errcode`,
 * usando sólo dos códigos: 42501 permisos, 22023 regla de negocio. El que
 * discrimina es el MENSAJE. Mismo criterio que inventory-actions.ts.
 */
const RPC_MESSAGES: Record<string, string> = {
  NO_OPEN_SESSION: "Abrí la caja antes de cobrar.",
  SESSION_ALREADY_OPEN: "Ya hay una caja abierta en esta sucursal.",
  SESSION_ALREADY_CLOSED: "Esta caja ya está cerrada.",
  SESSION_NOT_FOUND: "Esa caja no existe.",
  PAYMENTS_DONT_MATCH_TOTAL: "Los pagos no suman el total de la venta.",
  EMPTY_SALE: "Agregá al menos un ítem antes de cobrar.",
  APPOINTMENT_ALREADY_CHARGED: "Este turno ya fue cobrado.",
  APPOINTMENT_NOT_FOUND: "Ese turno no existe.",
  DISCOUNT_EXCEEDS_TOTAL: "El descuento no puede ser mayor al total.",
  NEGATIVE_DISCOUNT: "El descuento no puede ser negativo.",
  NEGATIVE_OPENING_AMOUNT: "El monto de apertura no puede ser negativo.",
  NEGATIVE_COUNTED_TOTAL: "Lo contado no puede ser negativo.",
  INVALID_QUANTITY: "La cantidad tiene que ser mayor a 0.",
  INVALID_PAYMENT_AMOUNT: "Cada pago tiene que ser mayor a 0.",
  OPERATOR_NOT_IN_TENANT: "Esa persona no trabaja en este salón.",
  SALE_ALREADY_VOIDED: "Esta venta ya está anulada.",
  SALE_NOT_FOUND: "Esa venta no existe.",
  VOID_REASON_REQUIRED: "Contá por qué la anulás.",
  ITEM_NOT_FOUND: "Alguno de los ítems ya no está disponible.",
  BRANCH_NOT_FOUND: "Esa sucursal no existe.",
  NOT_ALLOWED_TO_SELL: "No tenés permiso para cobrar.",
  NOT_ALLOWED_TO_VOID: "Solo el dueño puede anular una venta.",
  NOT_ALLOWED_TO_OPEN_SESSION: "No tenés permiso para abrir la caja.",
  NOT_ALLOWED_TO_CLOSE_SESSION: "No tenés permiso para cerrar la caja.",
}

function rpcError(
  error: { message: string; code?: string | null },
  fallback: string,
): ActionResult<never> {
  for (const [needle, text] of Object.entries(RPC_MESSAGES)) {
    if (error.message.includes(needle)) return { ok: false, error: text, code: error.code }
  }
  if (error.code === "42501") {
    return { ok: false, error: "No tenés permiso para esta acción.", code: error.code }
  }
  return { ok: false, error: fallback, code: error.code }
}

export async function openCashSession(
  branchId: string,
  openingAmount: number,
): Promise<ActionResult<string>> {
  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    return { ok: false, error: "El monto de apertura no puede ser negativo." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("open_cash_session", {
    p_branch_id: branchId,
    p_opening_amount: openingAmount,
  })
  if (error) return rpcError(error, "No pudimos abrir la caja.")

  revalidateCaja()
  return { ok: true, data: data as string }
}

export async function closeCashSession(
  sessionId: string,
  countedTotal: number,
): Promise<ActionResult<{ expected: number; counted: number; difference: number }>> {
  if (!Number.isFinite(countedTotal) || countedTotal < 0) {
    return { ok: false, error: "Lo contado no puede ser negativo." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("close_cash_session", {
    p_session_id: sessionId,
    p_counted_total: countedTotal,
  })
  if (error) return rpcError(error, "No pudimos cerrar la caja.")

  revalidateCaja()
  const row = data?.[0]
  return {
    ok: true,
    data: {
      expected: Number(row?.expected_total ?? 0),
      counted: Number(row?.counted_total ?? 0),
      difference: Number(row?.difference ?? 0),
    },
  }
}

export async function confirmSale(
  branchId: string,
  clientId: string | null,
  appointmentId: string | null,
  lines: SaleLineInput[],
  payments: PaymentInput[],
  discount: number,
): Promise<ActionResult<{ saleId: string; total: number }>> {
  if (lines.length === 0) return { ok: false, error: "Agregá al menos un ítem antes de cobrar." }
  if (!Number.isFinite(discount) || discount < 0) {
    return { ok: false, error: "El descuento no puede ser negativo." }
  }
  if (payments.length === 0) return { ok: false, error: "Agregá al menos un pago." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("confirm_sale", {
    p_branch_id: branchId,
    p_client_id: clientId,
    p_appointment_id: appointmentId,
    p_items: lines,
    p_payments: payments,
    p_discount: discount,
  })
  if (error) return rpcError(error, "No pudimos registrar la venta.")

  const row = data?.[0]
  if (!row) return { ok: false, error: "No pudimos registrar la venta." }

  revalidateCaja()
  return { ok: true, data: { saleId: row.sale_id, total: Number(row.total) } }
}

export async function voidSale(saleId: string, reason: string): Promise<ActionResult> {
  if (!reason.trim()) return { ok: false, error: "Contá por qué la anulás." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("void_sale", { p_sale_id: saleId, p_reason: reason.trim() })
  if (error) return rpcError(error, "No pudimos anular la venta.")

  revalidateCaja()
  return { ok: true, data: undefined }
}
