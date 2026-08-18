"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { AdjustmentKind, InventoryItemType, ProductInput, SupplyInput, SupplyUnit } from "./inventory-types"

// Declarado local en vez de importado de otro módulo: cada módulo declara
// el suyo (service-actions.ts y client-actions.ts hacen lo mismo).
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

// Revalidar también /dashboard: el Panel muestra las alertas de stock bajo.
function revalidateInventory() {
  revalidatePath("/dashboard/inventario")
  revalidatePath("/dashboard")
}

/**
 * Los RPC de 0012 levantan errores de dominio con `raise ... using errcode`,
 * y usan sólo dos códigos: 42501 para permisos, 22023 para reglas de negocio.
 * El que discrimina es el MENSAJE, así que traducimos por mensaje y dejamos
 * el código sólo para el caso de permisos, que es transversal.
 *
 * Cualquier mensaje que no esté acá es un error que no previmos: cae al
 * fallback del llamador, que describe la operación que falló.
 */
const RPC_MESSAGES: Record<string, string> = {
  NEGATIVE_STOCK: "El movimiento dejaría el stock en negativo.",
  ITEM_NOT_FOUND: "Ese ítem ya no existe.",
  BRANCH_NOT_FOUND: "Esa sucursal no existe.",
  REASON_NOT_ALLOWED: "Ese tipo de movimiento no se puede registrar a mano.",
  NOT_ALLOWED_TO_ADJUST_STOCK: "No tenés permiso para mover stock.",
  NOT_ALLOWED_TO_DELETE_ITEM: "Solo el dueño puede eliminar del inventario.",
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

export async function createSupply(tenantId: string, input: SupplyInput): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio." }
  if (input.costPerUnit !== undefined && (!Number.isFinite(input.costPerUnit) || input.costPerUnit < 0)) {
    return { ok: false, error: "El costo no puede ser negativo." }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("supplies").insert({
    tenant_id: tenantId,
    name: input.name.trim(),
    unit: input.unit,
    // Quien no ve costos (no-owner) crea el insumo sin costo: nace en 0 y
    // la dueña lo completa después. No 0-por-defecto silencioso: acá se
    // elige explícitamente no mandar la columna.
    cost_per_unit: input.costPerUnit ?? 0,
  })
  if (error) return { ok: false, error: "No pudimos crear el insumo.", code: error.code }

  revalidateInventory()
  return { ok: true, data: undefined }
}

export async function updateSupply(supplyId: string, input: SupplyInput): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio." }
  if (input.costPerUnit !== undefined && (!Number.isFinite(input.costPerUnit) || input.costPerUnit < 0)) {
    return { ok: false, error: "El costo no puede ser negativo." }
  }

  // costPerUnit ausente (quien no ve costos, ver 0017) no entra al update:
  // si mandáramos cost_per_unit siempre, una encargada editando sólo el
  // nombre pisaría el costo real con lo que tenga el form, que ella no ve.
  const patch: { name: string; unit: SupplyUnit; cost_per_unit?: number } = {
    name: input.name.trim(),
    unit: input.unit,
  }
  if (input.costPerUnit !== undefined) patch.cost_per_unit = input.costPerUnit

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("supplies")
    .update(patch)
    .eq("id", supplyId)
    .select("id")
    .maybeSingle()
  if (error) return { ok: false, error: "No pudimos guardar los cambios.", code: error.code }
  if (!data) return { ok: false, error: "No pudimos guardar los cambios. Puede que no tengas permiso." }

  revalidateInventory()
  return { ok: true, data: undefined }
}

export async function createProduct(tenantId: string, input: ProductInput): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio." }
  if (!Number.isFinite(input.salePrice) || input.salePrice < 0) {
    return { ok: false, error: "El precio de venta no puede ser negativo." }
  }
  if (input.cost !== undefined && (!Number.isFinite(input.cost) || input.cost < 0)) {
    return { ok: false, error: "El costo no puede ser negativo." }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("retail_products").insert({
    tenant_id: tenantId,
    name: input.name.trim(),
    sale_price: input.salePrice,
    cost: input.cost ?? 0,
  })
  if (error) return { ok: false, error: "No pudimos crear el producto.", code: error.code }

  revalidateInventory()
  return { ok: true, data: undefined }
}

export async function updateProduct(productId: string, input: ProductInput): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio." }
  if (!Number.isFinite(input.salePrice) || input.salePrice < 0) {
    return { ok: false, error: "El precio de venta no puede ser negativo." }
  }
  if (input.cost !== undefined && (!Number.isFinite(input.cost) || input.cost < 0)) {
    return { ok: false, error: "El costo no puede ser negativo." }
  }

  const patch: { name: string; sale_price: number; cost?: number } = {
    name: input.name.trim(),
    sale_price: input.salePrice,
  }
  if (input.cost !== undefined) patch.cost = input.cost

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("retail_products")
    .update(patch)
    .eq("id", productId)
    .select("id")
    .maybeSingle()
  if (error) return { ok: false, error: "No pudimos guardar los cambios.", code: error.code }
  if (!data) return { ok: false, error: "No pudimos guardar los cambios. Puede que no tengas permiso." }

  revalidateInventory()
  return { ok: true, data: undefined }
}

/**
 * Borrado suave vía RPC: la fila tiene que sobrevivir para que el historial
 * de movimientos siga siendo legible (item_id es polimórfico y no tiene FK).
 * El RPC además chequea que sea la dueña. Ver migrations/0012.
 */
export async function deleteInventoryItem(
  itemId: string,
  itemType: InventoryItemType,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("soft_delete_inventory_item", {
    p_item_id: itemId,
    p_item_type: itemType,
  })
  if (error) return rpcError(error, "No pudimos eliminar el ítem.")

  revalidateInventory()
  return { ok: true, data: undefined }
}

/**
 * Mueve stock. `amount` es siempre positivo salvo en "ajuste", donde puede
 * venir con signo; en "recuento" es la cantidad contada, no un delta, y por
 * eso va por otro RPC que hace la resta bajo el mismo lock.
 *
 * Devuelve el saldo resultante.
 */
export async function adjustStock(
  branchId: string,
  itemId: string,
  itemType: InventoryItemType,
  kind: AdjustmentKind,
  amount: number,
  note: string | null,
): Promise<ActionResult<number>> {
  if (!Number.isFinite(amount)) return { ok: false, error: "La cantidad no es válida." }
  if (kind !== "ajuste" && amount < 0) return { ok: false, error: "La cantidad no puede ser negativa." }
  if (kind !== "ajuste" && amount === 0) return { ok: false, error: "La cantidad tiene que ser mayor a 0." }
  if (kind === "ajuste" && amount === 0) return { ok: false, error: "El ajuste no puede ser 0." }

  const supabase = await createClient()

  if (kind === "recuento") {
    const { data, error } = await supabase.rpc("record_stock_count", {
      p_branch_id: branchId,
      p_item_id: itemId,
      p_item_type: itemType,
      p_counted: amount,
      p_note: note,
    })
    if (error) return rpcError(error, "No pudimos registrar el recuento.")
    revalidateInventory()
    return { ok: true, data: Number(data) }
  }

  const delta = kind === "rotura" ? -amount : amount
  const { data, error } = await supabase.rpc("adjust_stock", {
    p_branch_id: branchId,
    p_item_id: itemId,
    p_item_type: itemType,
    p_delta: delta,
    p_reason: kind,
    p_note: note,
  })
  if (error) return rpcError(error, "No pudimos registrar el movimiento.")

  revalidateInventory()
  return { ok: true, data: Number(data) }
}

/**
 * El mínimo no mueve stock, así que no es un movimiento: va por un upsert
 * común a inventory, que las policies ya habilitan a dueña y supervisora.
 */
export async function setMinAlertLevel(
  branchId: string,
  itemId: string,
  itemType: InventoryItemType,
  level: number,
): Promise<ActionResult> {
  if (!Number.isFinite(level) || level < 0) return { ok: false, error: "El mínimo no puede ser negativo." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("inventory")
    .upsert(
      { branch_id: branchId, item_id: itemId, item_type: itemType, min_alert_level: level },
      { onConflict: "branch_id,item_id,item_type" },
    )
  if (error) return { ok: false, error: "No pudimos guardar el mínimo.", code: error.code }

  revalidateInventory()
  return { ok: true, data: undefined }
}
