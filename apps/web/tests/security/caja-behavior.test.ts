/**
 * Invariantes del módulo Caja a nivel de datos: quién puede cobrar, que el
 * precio lo pone el servidor, que los pagos cierran, que anular compensa en
 * vez de borrar, y que el arqueo sólo cuenta el efectivo.
 *
 * Mismo patrón que tests/security/inventario-behavior.test.ts: datos 100%
 * descartables contra el proyecto real, borrados en el finally.
 *
 * Ejecutar: pnpm test:caja (desde apps/web, con .env.local cargado)
 */
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Faltan env vars. Corré con apps/web/.env.local cargado.")
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function createTestUser(label: string) {
  const email = `caja-test-${label}-${Date.now()}@example.com`
  const password = `Test-${Math.random().toString(36).slice(2)}!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`No pude crear usuario ${label}: ${error?.message}`)
  return { id: data.user.id, email, password }
}

async function signIn(email: string, password: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`No pude loguear ${email}: ${error.message}`)
  return client
}

async function main() {
  const userIds: string[] = []
  let tenantId: string | undefined
  let branchId: string | undefined
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Caja Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) {
      throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    }
    tenantId = tenantRow[0].tenant_id
    branchId = tenantRow[0].branch_id

    // --- Catálogo mínimo: un producto de reventa con stock ---
    const { data: product, error: productError } = await ownerClient
      .from("retail_products")
      .insert({ tenant_id: tenantId, name: "Shampoo Caja Test", sale_price: 5000, cost: 2000 })
      .select("id")
      .single()
    if (productError || !product) throw new Error(`No pude crear el producto: ${productError?.message}`)
    const productId = product.id

    await ownerClient.rpc("adjust_stock", {
      p_branch_id: branchId,
      p_item_id: productId,
      p_item_type: "product",
      p_delta: 10,
      p_reason: "compra",
      p_note: "carga inicial",
    })

    // --- Test 1 ---
    console.log("Test 1: vender un producto descuenta stock y deja movimiento 'venta'...")
    {
      // Se insertan la venta y el ítem con service_role a propósito: en esta
      // task confirm_sale todavía no existe, y lo que se está probando es el
      // trigger, no el camino de escritura. La Task 3 cierra las policies.
      const { data: sale, error: saleError } = await admin
        .from("sales")
        .insert({ tenant_id: tenantId, branch_id: branchId, total: 5000 })
        .select("id")
        .single()
      if (saleError || !sale) throw new Error(`No pude crear la venta: ${saleError?.message}`)

      const { error: itemError } = await admin.from("sale_items").insert({
        sale_id: sale.id,
        item_type: "product",
        item_id: productId,
        quantity: 1,
        unit_price: 5000,
      })
      if (itemError) throw new Error(`No pude crear el sale_item: ${itemError.message}`)

      const { data: inv } = await admin
        .from("inventory")
        .select("current_stock")
        .eq("branch_id", branchId)
        .eq("item_id", productId)
        .eq("item_type", "product")
        .single()

      const { data: movements } = await admin
        .from("inventory_movements")
        .select("delta, reason, resulting_stock")
        .eq("item_id", productId)
        .eq("reason", "venta")

      const stockOk = Number(inv?.current_stock) === 9
      const movementOk =
        movements?.length === 1 &&
        Number(movements[0].delta) === -1 &&
        Number(movements[0].resulting_stock) === 9

      if (stockOk && movementOk) {
        console.log("  OK — stock 10 → 9 y un movimiento 'venta' de -1")
      } else {
        failures++
        console.error(
          `  FALLO — stock=${inv?.current_stock} (esperaba 9), movimientos=${JSON.stringify(movements)}`,
        )
      }
    }
  } catch (err) {
    failures++
    console.error("Error inesperado:", err instanceof Error ? err.message : err)
  } finally {
    console.log("Limpiando datos de prueba...")
    if (tenantId) {
      const { data: branches } = await admin.from("branches").select("id").eq("tenant_id", tenantId)
      const branchIds = (branches ?? []).map((b) => b.id)
      const { data: sales } = await admin.from("sales").select("id").eq("tenant_id", tenantId)
      const saleIds = (sales ?? []).map((s) => s.id)
      if (saleIds.length > 0) {
        await admin.from("commission_ledger").delete().eq("tenant_id", tenantId)
        await admin.from("payments").delete().in("sale_id", saleIds)
        await admin.from("sale_items").delete().in("sale_id", saleIds)
      }
      await admin.from("sales").delete().eq("tenant_id", tenantId)
      await admin.from("cash_sessions").delete().eq("tenant_id", tenantId)
      await admin.from("inventory_movements").delete().eq("tenant_id", tenantId)
      if (branchIds.length > 0) await admin.from("inventory").delete().in("branch_id", branchIds)
      const { data: appts } = await admin.from("appointments").select("id").eq("tenant_id", tenantId)
      const apptIds = (appts ?? []).map((a) => a.id)
      if (apptIds.length > 0) {
        await admin.from("appointment_services").delete().in("appointment_id", apptIds)
      }
      await admin.from("appointments").delete().eq("tenant_id", tenantId)
      const { data: svcs } = await admin.from("services").select("id").eq("tenant_id", tenantId)
      const svcIds = (svcs ?? []).map((s) => s.id)
      if (svcIds.length > 0) {
        await admin.from("service_supplies").delete().in("service_id", svcIds)
      }
      await admin.from("services").delete().eq("tenant_id", tenantId)
      await admin.from("supplies").delete().eq("tenant_id", tenantId)
      await admin.from("retail_products").delete().eq("tenant_id", tenantId)
      await admin.from("clients").delete().eq("tenant_id", tenantId)
      await admin.from("memberships").delete().eq("tenant_id", tenantId)
      await admin.from("branches").delete().eq("tenant_id", tenantId)
      await admin.from("commission_rules").delete().eq("tenant_id", tenantId)
      await admin.from("tenants").delete().eq("id", tenantId)
    }
    for (const id of userIds) {
      await admin.from("users").delete().eq("id", id)
      await admin.auth.admin.deleteUser(id)
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) de Caja fallaron.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Caja pasaron.")
}

main()
