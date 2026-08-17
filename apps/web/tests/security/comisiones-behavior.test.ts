/**
 * Invariantes del módulo Comisiones: sólo la dueña administra reglas y
 * asigna, sólo la dueña liquida, y la liquidación es correcta y por período.
 *
 * Mismo patrón que tests/security/caja-behavior.test.ts: datos 100%
 * descartables contra el proyecto real, borrados en el finally.
 *
 * Ejecutar: pnpm test:comisiones (desde apps/web, con .env.local cargado)
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
  const email = `comisiones-test-${label}-${Date.now()}@example.com`
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
      p_business_name: "Comisiones Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    branchId = tenantRow[0].branch_id

    console.log("Creando operadora...")
    const operator = await createTestUser("operator")
    userIds.push(operator.id)
    await admin.from("memberships").insert({
      tenant_id: tenantId,
      user_id: operator.id,
      branch_id: branchId,
      role: "operator",
    })
    const operatorClient = await signIn(operator.email, operator.password)

    // --- Test 1: la operadora no puede crear/editar/borrar una regla ---
    console.log("Test 1: la operadora no puede crear, editar ni borrar una regla...")
    {
      const { error: insertError } = await operatorClient
        .from("commission_rules")
        .insert({ tenant_id: tenantId, name: "Regla de operadora", service_pct: 50 })
      const insertBlocked = !!insertError

      const { data: rule } = await admin
        .from("commission_rules")
        .insert({ tenant_id: tenantId, name: "Regla base", base_salary: 100000, service_pct: 20, product_sale_pct: 10 })
        .select("id")
        .single()

      const { data: updateResult, error: updateError } = await operatorClient
        .from("commission_rules")
        .update({ service_pct: 90 })
        .eq("id", rule!.id)
        .select("id")
        .maybeSingle()
      const updateBlocked = !!updateError || !updateResult

      const { data: deleteResult } = await operatorClient
        .from("commission_rules")
        .delete()
        .eq("id", rule!.id)
        .select("id")
      const deleteBlocked = (deleteResult ?? []).length === 0

      if (insertBlocked && updateBlocked && deleteBlocked) {
        console.log("  OK — las tres operaciones quedaron bloqueadas")
      } else {
        failures++
        console.error(
          `  FALLO — insert=${insertBlocked}, update=${updateBlocked}, delete=${deleteBlocked}`,
        )
      }

      // --- Test 2: la operadora no puede asignarse una regla a sí misma ---
      console.log("Test 2: la operadora no puede asignarse una regla a sí misma...")
      const { data: selfAssign } = await operatorClient
        .from("memberships")
        .update({ commission_rule_id: rule!.id })
        .eq("user_id", operator.id)
        .select("id")
      if ((selfAssign ?? []).length === 0) {
        console.log("  OK — bloqueado por RLS")
      } else {
        failures++
        console.error("  FALLO — la operadora pudo autoasignarse una regla")
      }

      // --- Test 3: la dueña sí puede asignarla ---
      console.log("Test 3: la dueña asigna la regla a la operadora...")
      const { data: ownerAssign, error: ownerAssignError } = await ownerClient
        .from("memberships")
        .update({ commission_rule_id: rule!.id })
        .eq("user_id", operator.id)
        .select("id")
        .maybeSingle()
      if (ownerAssignError || !ownerAssign) {
        failures++
        console.error(`  FALLO — la dueña no pudo asignar: ${ownerAssignError?.message}`)
      } else {
        console.log("  OK — asignada")
      }
    }

    // --- Test 4: la operadora no puede liquidar ---
    console.log("Test 4: la operadora no puede llamar a settle_commission_period...")
    {
      const { error } = await operatorClient.rpc("settle_commission_period", {
        p_tenant_id: tenantId,
        p_period: "2026-08",
      })
      if (error?.code === "42501") {
        console.log("  OK — rechazada con 42501")
      } else {
        failures++
        console.error(`  FALLO — esperaba 42501, llegó: ${JSON.stringify(error)}`)
      }
    }

    // --- Test 5: la dueña liquida un período; otro período no se toca ---
    console.log("Test 5: liquidar un período marca settled sólo ahí...")
    {
      const { data: service } = await ownerClient
        .from("services")
        .insert({ tenant_id: tenantId, name: "Corte Comisión Test", price: 10000, duration_minutes: 30 })
        .select("id")
        .single()

      await ownerClient.rpc("open_cash_session", { p_branch_id: branchId, p_opening_amount: 0 })

      // Una venta ahora (período actual) con comisión para la operadora.
      const { error: saleError } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: service!.id, item_type: "service", quantity: 1, operator_id: operator.id }],
        p_payments: [{ method: "cash", amount: 10000 }],
        p_discount: 0,
      })
      if (saleError) throw new Error(`No pude cobrar para generar comisión: ${saleError.message}`)

      const now = new Date()
      const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

      // Un asiento manual de OTRO período, para probar que no se toca.
      const { data: ledgerRow } = await admin
        .from("commission_ledger")
        .select("id, sale_item_id")
        .eq("tenant_id", tenantId)
        .eq("operator_id", operator.id)
        .single()
      await admin.from("commission_ledger").insert({
        tenant_id: tenantId,
        operator_id: operator.id,
        sale_item_id: ledgerRow!.sale_item_id,
        amount: 999,
        rule_snapshot: {},
        period: "2020-01",
        settled: false,
      })

      const { data: settledCount, error: settleError } = await ownerClient.rpc("settle_commission_period", {
        p_tenant_id: tenantId,
        p_period: currentPeriod,
      })

      const { data: currentRows } = await admin
        .from("commission_ledger")
        .select("settled")
        .eq("tenant_id", tenantId)
        .eq("period", currentPeriod)
      const { data: oldRows } = await admin
        .from("commission_ledger")
        .select("settled")
        .eq("tenant_id", tenantId)
        .eq("period", "2020-01")

      const currentAllSettled = (currentRows ?? []).every((r) => r.settled === true)
      const oldUntouched = (oldRows ?? []).every((r) => r.settled === false)

      if (!settleError && (settledCount ?? 0) > 0 && currentAllSettled && oldUntouched) {
        console.log(`  OK — liquidó ${settledCount} asiento(s) del período actual, 2020-01 quedó intacto`)
      } else {
        failures++
        console.error(
          `  FALLO — settledCount=${settledCount}, currentAllSettled=${currentAllSettled}, oldUntouched=${oldUntouched}, error=${settleError?.message}`,
        )
      }

      // --- Test 6: liquidar de nuevo (nada pendiente) no rompe ---
      console.log("Test 6: liquidar un período sin pendientes devuelve 0, no error...")
      const { data: secondRun, error: secondError } = await ownerClient.rpc("settle_commission_period", {
        p_tenant_id: tenantId,
        p_period: currentPeriod,
      })
      if (!secondError && secondRun === 0) {
        console.log("  OK — 0 filas, sin error")
      } else {
        failures++
        console.error(`  FALLO — esperaba 0 sin error, llegó count=${secondRun} error=${secondError?.message}`)
      }
    }

    // --- Test 7: aislamiento cross-tenant ---
    console.log("Test 7: un miembro de otro tenant no lee reglas ni ledger ajeno, ni liquida...")
    {
      const intruder = await createTestUser("intruder")
      userIds.push(intruder.id)
      const intruderClient = await signIn(intruder.email, intruder.password)
      await intruderClient.rpc("provision_tenant", { p_business_name: "Otro Salon Comisiones" })

      const { data: rules } = await intruderClient.from("commission_rules").select("id").eq("tenant_id", tenantId)
      const { data: ledger } = await intruderClient.from("commission_ledger").select("id").eq("tenant_id", tenantId)
      const { error: settleError } = await intruderClient.rpc("settle_commission_period", {
        p_tenant_id: tenantId,
        p_period: "2026-08",
      })

      const rulesBlocked = (rules ?? []).length === 0
      const ledgerBlocked = (ledger ?? []).length === 0
      const settleBlocked = settleError?.code === "42501"

      if (rulesBlocked && ledgerBlocked && settleBlocked) {
        console.log("  OK — sin filtración de lectura ni escritura")
      } else {
        failures++
        console.error(`  FALLO — rules=${rulesBlocked}, ledger=${ledgerBlocked}, settle=${settleBlocked}`)
      }
    }
  } catch (err) {
    failures++
    console.error("Error inesperado:", err instanceof Error ? err.message : err)
  } finally {
    console.log("Limpiando datos de prueba...")
    const { data: strayTenants } = await admin
      .from("tenants").select("id").eq("business_name", "Otro Salon Comisiones")
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
      await admin.from("inventory_movements").delete().eq("tenant_id", tenantId)
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
    console.error(`\n${failures} test(s) de Comisiones fallaron.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Comisiones pasaron.")
}

main()
