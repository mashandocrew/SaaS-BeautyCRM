/**
 * Invariantes de datos que sostienen el módulo Reportes: las ventas
 * anuladas quedan afuera de los totales, el filtro por sucursal aísla
 * correctamente (es lo que la página usa para acotar a la encargada), y
 * no hay fuga entre tenants. Las queries de reportes-queries.ts no se
 * llaman directo (usan createClient() de @beautycrm/supabase/server, que
 * depende de next/headers) — se reproduce el mismo filtro que usan,
 * mismo patrón que el resto de tests/security/*.
 *
 * Ejecutar: pnpm test:reportes (desde apps/web, con .env.local cargado)
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
  const email = `reportes-test-${label}-${Date.now()}@example.com`
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
  let branchAId: string | undefined
  let branchBId: string | undefined
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba con dos sucursales...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Reportes Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    branchAId = tenantRow[0].branch_id

    await admin.from("tenants").update({ mode: "multi" }).eq("id", tenantId)
    const { data: branchB } = await admin
      .from("branches")
      .insert({ tenant_id: tenantId, name: "Sucursal B" })
      .select("id")
      .single()
    branchBId = branchB!.id

    const { data: service } = await ownerClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Corte Reportes Test", price: 6000, duration_minutes: 30 })
      .select("id")
      .single()

    // --- Una venta en cada sucursal ---
    await ownerClient.rpc("open_cash_session", { p_branch_id: branchAId, p_opening_amount: 0 })
    const { data: saleARows, error: saleAError } = await ownerClient.rpc("confirm_sale", {
      p_branch_id: branchAId,
      p_client_id: null,
      p_appointment_id: null,
      p_items: [{ item_id: service!.id, item_type: "service", quantity: 1, operator_id: null }],
      p_payments: [{ method: "cash", amount: 6000 }],
      p_discount: 0,
    })
    if (saleAError || !saleARows?.[0]) throw new Error(`No pude cobrar en sucursal A: ${saleAError?.message}`)
    const saleA = saleARows[0]

    await ownerClient.rpc("open_cash_session", { p_branch_id: branchBId, p_opening_amount: 0 })
    const { error: saleBError } = await ownerClient.rpc("confirm_sale", {
      p_branch_id: branchBId,
      p_client_id: null,
      p_appointment_id: null,
      p_items: [{ item_id: service!.id, item_type: "service", quantity: 1, operator_id: null }],
      p_payments: [{ method: "cash", amount: 6000 }],
      p_discount: 0,
    })
    if (saleBError) throw new Error(`No pude cobrar en sucursal B: ${saleBError.message}`)

    // --- Test 1: el filtro por sucursal aísla A de B ---
    console.log("Test 1: filtrar por sucursal trae sólo esa sucursal...")
    {
      const { data: onlyA } = await ownerClient.from("sales").select("total, branch_id").eq("tenant_id", tenantId).eq("branch_id", branchAId).is("voided_at", null)
      const totalsA = (onlyA ?? []).map((s) => Number(s.total))
      if (totalsA.length === 1 && totalsA[0] === 6000) {
        console.log("  OK — sólo trajo la venta de la sucursal A")
      } else {
        failures++
        console.error(`  FALLO — esperaba [6000], llegó ${JSON.stringify(totalsA)}`)
      }
    }

    // --- Test 2: sin filtro, la dueña ve ambas sucursales ---
    console.log("Test 2: sin filtro de sucursal, la dueña ve el total del tenant...")
    {
      const { data: all } = await ownerClient.from("sales").select("total").eq("tenant_id", tenantId).is("voided_at", null)
      const total = (all ?? []).reduce((acc, s) => acc + Number(s.total), 0)
      if (total === 12000) {
        console.log("  OK — 6000 + 6000 = 12000")
      } else {
        failures++
        console.error(`  FALLO — esperaba 12000, llegó ${total}`)
      }
    }

    // --- Test 3: una venta anulada sale del total ---
    console.log("Test 3: anular una venta la saca del total...")
    {
      const { error: voidError } = await ownerClient.rpc("void_sale", { p_sale_id: saleA.sale_id, p_reason: "prueba de reportes" })
      const { data: afterVoid } = await ownerClient.from("sales").select("total").eq("tenant_id", tenantId).is("voided_at", null)
      const total = (afterVoid ?? []).reduce((acc, s) => acc + Number(s.total), 0)
      if (!voidError && total === 6000) {
        console.log("  OK — quedó sólo la venta de B, 6000")
      } else {
        failures++
        console.error(`  FALLO — voidError=${voidError?.message}, total=${total}`)
      }
    }

    // --- Test 4: inventory_costs rechaza a la operadora (valorización se oculta) ---
    console.log("Test 4: la operadora no puede leer la valorización de inventario...")
    {
      const operator = await createTestUser("operator")
      userIds.push(operator.id)
      await admin.from("memberships").insert({ tenant_id: tenantId, user_id: operator.id, branch_id: branchAId, role: "operator" })
      const operatorClient = await signIn(operator.email, operator.password)

      const { error } = await operatorClient.rpc("inventory_costs", { p_tenant_id: tenantId })
      if (error?.code === "42501") {
        console.log("  OK — rechazada con 42501; la UI la traduce a 'no mostrar la tarjeta'")
      } else {
        failures++
        console.error(`  FALLO — esperaba 42501, llegó: ${JSON.stringify(error)}`)
      }
    }

    // --- Test 5: aislamiento cross-tenant ---
    console.log("Test 5: un miembro de otro tenant no ve las ventas de este...")
    {
      const intruder = await createTestUser("intruder")
      userIds.push(intruder.id)
      const intruderClient = await signIn(intruder.email, intruder.password)
      await intruderClient.rpc("provision_tenant", { p_business_name: "Otro Salon Reportes" })

      const { data: leaked } = await intruderClient.from("sales").select("id").eq("tenant_id", tenantId)
      if ((leaked ?? []).length === 0) {
        console.log("  OK — 0 filas visibles")
      } else {
        failures++
        console.error(`  FALLO — vio ${leaked?.length} ventas ajenas`)
      }
    }
  } catch (err) {
    failures++
    console.error("Error inesperado:", err instanceof Error ? err.message : err)
  } finally {
    console.log("Limpiando datos de prueba...")
    const { data: strayTenants } = await admin.from("tenants").select("id").eq("business_name", "Otro Salon Reportes")
    for (const t of strayTenants ?? []) {
      await admin.from("memberships").delete().eq("tenant_id", t.id)
      await admin.from("branches").delete().eq("tenant_id", t.id)
      await admin.from("commission_rules").delete().eq("tenant_id", t.id)
      await admin.from("tenants").delete().eq("id", t.id)
    }
    if (tenantId) {
      const { data: sales } = await admin.from("sales").select("id").eq("tenant_id", tenantId)
      const saleIds = (sales ?? []).map((s) => s.id)
      await admin.from("commission_ledger").delete().eq("tenant_id", tenantId)
      if (saleIds.length > 0) {
        await admin.from("payments").delete().in("sale_id", saleIds)
        await admin.from("sale_items").delete().in("sale_id", saleIds)
      }
      await admin.from("sales").delete().eq("tenant_id", tenantId)
      await admin.from("cash_sessions").delete().eq("tenant_id", tenantId)
      await admin.from("services").delete().eq("tenant_id", tenantId)
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
    console.error(`\n${failures} test(s) de Reportes fallaron.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Reportes pasaron.")
}

main()
