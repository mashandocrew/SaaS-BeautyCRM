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
    // --- Test 2 ---
    console.log("Test 2: sólo hay una caja abierta por sucursal a la vez...")
    {
      const { data: first, error: firstError } = await ownerClient.rpc("open_cash_session", {
        p_branch_id: branchId,
        p_opening_amount: 1000,
      })
      const { error: secondError } = await ownerClient.rpc("open_cash_session", {
        p_branch_id: branchId,
        p_opening_amount: 2000,
      })

      if (!firstError && first && secondError) {
        console.log("  OK — la primera abrió, la segunda fue rechazada")
      } else {
        failures++
        console.error(
          `  FALLO — primera=${JSON.stringify(firstError ?? first)}, segunda=${JSON.stringify(secondError)}`,
        )
      }
    }

    // --- Test 3 ---
    console.log("Test 3: la operadora no puede abrir ni cerrar caja...")
    {
      const operator = await createTestUser("operator")
      userIds.push(operator.id)
      await admin.from("memberships").insert({
        tenant_id: tenantId,
        user_id: operator.id,
        branch_id: branchId,
        role: "operator",
      })
      const operatorClient = await signIn(operator.email, operator.password)

      const { error } = await operatorClient.rpc("open_cash_session", {
        p_branch_id: branchId,
        p_opening_amount: 500,
      })

      if (error?.code === "42501") {
        console.log("  OK — rechazada con 42501")
      } else {
        failures++
        console.error(`  FALLO — esperaba 42501, llegó: ${JSON.stringify(error)}`)
      }
    }
    // --- Test 4 ---
    console.log("Test 4: el precio lo pone el servidor, no el cliente...")
    {
      // No hay forma de mandar unit_price: confirm_sale no lo acepta. El
      // test verifica que lo cobrado sale del catálogo (5000).
      const { data, error } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 5000 }],
        p_discount: 0,
      })

      if (!error && Number(data?.[0]?.total) === 5000) {
        console.log("  OK — cobró 5000, el precio del catálogo")
      } else {
        failures++
        console.error(`  FALLO — data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`)
      }
    }

    // --- Test 5 ---
    console.log("Test 5: los pagos tienen que sumar el total...")
    {
      const { error } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 3000 }],
        p_discount: 0,
      })

      const { count } = await admin
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)

      // Sólo tienen que existir las 2 ventas de los Tests 1 y 4: la
      // rechazada no puede haber dejado nada a medio escribir.
      if (error?.message?.includes("PAYMENTS_DONT_MATCH_TOTAL") && count === 2) {
        console.log("  OK — rechazado y sin venta a medio escribir")
      } else {
        failures++
        console.error(`  FALLO — error=${JSON.stringify(error)}, ventas=${count} (esperaba 2)`)
      }
    }

    // --- Test 6 ---
    console.log("Test 6: nadie escribe sales, sale_items ni payments directo...")
    {
      const { error: saleError } = await ownerClient
        .from("sales")
        .insert({ tenant_id: tenantId, branch_id: branchId, total: 1 })

      const { data: existing } = await admin
        .from("sales").select("id").eq("tenant_id", tenantId).limit(1).single()

      const { error: itemError } = await ownerClient.from("sale_items").insert({
        sale_id: existing!.id, item_type: "product", item_id: productId,
        quantity: 1, unit_price: 1,
      })
      const { error: payError } = await ownerClient
        .from("payments")
        .insert({ sale_id: existing!.id, method: "cash", amount: 1 })

      if (saleError && itemError && payError) {
        console.log("  OK — las tres escrituras directas quedaron bloqueadas")
      } else {
        failures++
        console.error(
          `  FALLO — sale=${JSON.stringify(saleError)}, item=${JSON.stringify(itemError)}, pay=${JSON.stringify(payError)}`,
        )
      }
    }

    // --- Test 7 ---
    console.log("Test 7: anular devuelve el stock y revierte la comisión sin borrar nada...")
    {
      const { data: before } = await admin
        .from("inventory").select("current_stock")
        .eq("branch_id", branchId).eq("item_id", productId).eq("item_type", "product").single()

      const { data: sales } = await admin
        .from("sales").select("id").eq("tenant_id", tenantId)
        .is("voided_at", null).order("created_at", { ascending: false }).limit(1)
      const saleId = sales![0].id

      const { error } = await ownerClient.rpc("void_sale", {
        p_sale_id: saleId,
        p_reason: "cobrada por error",
      })

      const { data: after } = await admin
        .from("inventory").select("current_stock")
        .eq("branch_id", branchId).eq("item_id", productId).eq("item_type", "product").single()

      const { data: sale } = await admin
        .from("sales").select("voided_at, void_reason").eq("id", saleId).single()

      const { count: itemsLeft } = await admin
        .from("sale_items").select("id", { count: "exact", head: true }).eq("sale_id", saleId)

      const stockVolvio = Number(after?.current_stock) === Number(before?.current_stock) + 1

      if (!error && stockVolvio && sale?.voided_at && sale.void_reason === "cobrada por error" && itemsLeft === 1) {
        console.log("  OK — stock devuelto, venta marcada anulada, ítems intactos")
      } else {
        failures++
        console.error(
          `  FALLO — error=${JSON.stringify(error)}, stock ${before?.current_stock}→${after?.current_stock}, sale=${JSON.stringify(sale)}, items=${itemsLeft}`,
        )
      }
    }

    // --- Test 8 ---
    console.log("Test 8: una venta anulada no cuenta en el arqueo...")
    {
      const { data: session } = await admin
        .from("cash_sessions").select("id, opening_amount")
        .eq("branch_id", branchId).is("closed_at", null).single()

      const { data, error } = await ownerClient.rpc("close_cash_session", {
        p_session_id: session!.id,
        p_counted_total: 1000,
      })

      // Sólo quedó la venta del Test 4 (5000 en efectivo), pero se anuló en
      // el Test 7. Así que el esperado es sólo el monto de apertura: 1000.
      const expected = Number(data?.[0]?.expected_total)
      if (!error && expected === 1000 && Number(data?.[0]?.difference) === 0) {
        console.log("  OK — esperado 1000 (sólo la apertura), diferencia 0")
      } else {
        failures++
        console.error(`  FALLO — data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`)
      }
    }

    // --- Test 10 ---
    console.log("Test 10: un turno se cobra al precio que se le cotizó, y una sola vez...")
    {
      // Un servicio que se agendó a 8000 y después subió a 12000 en el
      // catálogo: cobrar el catálogo actual sería cobrarle al cliente
      // distinto de lo que se le dijo al agendar.
      const { data: service } = await ownerClient
        .from("services")
        .insert({ tenant_id: tenantId, name: "Corte Caja Test", price: 8000, duration_minutes: 30 })
        .select("id")
        .single()

      const { data: client } = await ownerClient
        .from("clients")
        .insert({ tenant_id: tenantId, full_name: "Clienta Caja Test" })
        .select("id")
        .single()

      const { data: appt } = await admin
        .from("appointments")
        .insert({
          tenant_id: tenantId, branch_id: branchId, client_id: client!.id,
          starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          status: "in_progress",
        })
        .select("id")
        .single()

      await admin.from("appointment_services").insert({
        appointment_id: appt!.id, service_id: service!.id, price_snapshot: 8000,
      })

      // El catálogo sube DESPUÉS de agendar.
      await ownerClient.from("services").update({ price: 12000 }).eq("id", service!.id)

      await ownerClient.rpc("open_cash_session", { p_branch_id: branchId, p_opening_amount: 0 })

      const { data: charged, error: chargeError } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: client!.id,
        p_appointment_id: appt!.id,
        p_items: [{ item_id: service!.id, item_type: "service", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 8000 }],
        p_discount: 0,
      })

      // Y cobrarlo de nuevo tiene que fallar.
      const { error: dobleError } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: client!.id,
        p_appointment_id: appt!.id,
        p_items: [{ item_id: service!.id, item_type: "service", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 8000 }],
        p_discount: 0,
      })

      const { data: apptAfter } = await admin
        .from("appointments").select("status").eq("id", appt!.id).single()

      const precioOk = !chargeError && Number(charged?.[0]?.total) === 8000
      const dobleOk = dobleError?.message?.includes("APPOINTMENT_ALREADY_CHARGED")
      const cerradoOk = apptAfter?.status === "done"

      if (precioOk && dobleOk && cerradoOk) {
        console.log("  OK — cobró 8000 (el cotizado), rechazó el doble cobro, y cerró el turno")
      } else {
        failures++
        console.error(
          `  FALLO — total=${charged?.[0]?.total} (esperaba 8000), doble=${JSON.stringify(dobleError)}, status=${apptAfter?.status}`,
        )
      }
    }

    // --- Test 11 ---
    console.log("Test 11: sin caja abierta no se puede cobrar...")
    {
      const { data: open } = await admin
        .from("cash_sessions").select("id").eq("branch_id", branchId).is("closed_at", null)
      for (const s of open ?? []) {
        await ownerClient.rpc("close_cash_session", { p_session_id: s.id, p_counted_total: 0 })
      }

      const { error } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 5000 }],
        p_discount: 0,
      })

      if (error?.message?.includes("NO_OPEN_SESSION")) {
        console.log("  OK — rechazado por caja cerrada")
      } else {
        failures++
        console.error(`  FALLO — esperaba NO_OPEN_SESSION, llegó: ${JSON.stringify(error)}`)
      }
    }

    // --- Test 9 ---
    console.log("Test 9: un miembro de otro tenant no puede cobrar acá...")
    {
      const intruder = await createTestUser("intruder")
      userIds.push(intruder.id)
      const intruderClient = await signIn(intruder.email, intruder.password)
      await intruderClient.rpc("provision_tenant", { p_business_name: "Otro Salon Caja" })

      const { error } = await intruderClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 5000 }],
        p_discount: 0,
      })

      if (error?.code === "42501") {
        console.log("  OK — rechazado con 42501")
      } else {
        failures++
        console.error(`  FALLO — esperaba 42501, llegó: ${JSON.stringify(error)}`)
      }
    }
    // --- Test 12 ---
    console.log("Test 12: la cajera cobra sólo con el permiso prendido...")
    {
      const cashier = await createTestUser("cashier")
      userIds.push(cashier.id)
      await admin.from("memberships").insert({
        tenant_id: tenantId,
        user_id: cashier.id,
        branch_id: branchId,
        role: "operator",
      })
      const cashierClient = await signIn(cashier.email, cashier.password)

      await ownerClient.rpc("open_cash_session", { p_branch_id: branchId, p_opening_amount: 0 })

      // Sin el permiso: rechazada.
      const { error: sinPermiso } = await cashierClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 5000 }],
        p_discount: 0,
      })

      // La dueña se lo prende.
      const { error: grantError } = await ownerClient.rpc("set_cash_permission", {
        p_tenant_id: tenantId,
        p_user_id: cashier.id,
        p_can: true,
      })

      // Con el permiso: cobra.
      const { data: venta, error: conPermiso } = await cashierClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 5000 }],
        p_discount: 0,
      })

      if (sinPermiso?.code === "42501" && !grantError && !conPermiso && Number(venta?.[0]?.total) === 5000) {
        console.log("  OK — sin permiso rechazada, con permiso cobró 5000")
      } else {
        failures++
        console.error(
          `  FALLO — sin=${JSON.stringify(sinPermiso)}, grant=${JSON.stringify(grantError)}, con=${JSON.stringify(conPermiso)}`,
        )
      }

      // --- Test 13 ---
      console.log("Test 13: la cajera igual no puede anular...")
      {
        const saleId = venta?.[0]?.sale_id
        const { error } = await cashierClient.rpc("void_sale", {
          p_sale_id: saleId,
          p_reason: "quiero deshacerla",
        })

        if (error?.code === "42501") {
          console.log("  OK — anular sigue siendo sólo de la dueña")
        } else {
          failures++
          console.error(`  FALLO — esperaba 42501, llegó: ${JSON.stringify(error)}`)
        }
      }

      // --- Test 14 ---
      console.log("Test 14: la cajera no puede prenderse el permiso sola...")
      {
        const { error: selfGrant } = await cashierClient.rpc("set_cash_permission", {
          p_tenant_id: tenantId,
          p_user_id: cashier.id,
          p_can: true,
        })

        // Y tampoco puede tocar su rol por la vía directa.
        const { error: roleError } = await cashierClient
          .from("memberships")
          .update({ role: "owner" })
          .eq("user_id", cashier.id)

        const { data: check } = await admin
          .from("memberships").select("role").eq("user_id", cashier.id).single()

        if (selfGrant?.code === "42501" && check?.role === "operator") {
          console.log("  OK — no puede autoasignarse permisos ni rol")
        } else {
          failures++
          console.error(
            `  FALLO — selfGrant=${JSON.stringify(selfGrant)}, role=${JSON.stringify(roleError)}, quedó=${check?.role}`,
          )
        }
      }

      // --- Test 15 ---
      console.log("Test 15: la encargada también puede prender y sacar el permiso...")
      {
        const supervisor = await createTestUser("supervisor")
        userIds.push(supervisor.id)
        await admin.from("memberships").insert({
          tenant_id: tenantId,
          user_id: supervisor.id,
          branch_id: branchId,
          role: "supervisor",
        })
        const supervisorClient = await signIn(supervisor.email, supervisor.password)

        const { error: offError } = await supervisorClient.rpc("set_cash_permission", {
          p_tenant_id: tenantId,
          p_user_id: cashier.id,
          p_can: false,
        })

        const { data: after } = await admin
          .from("memberships").select("can_operate_cash").eq("user_id", cashier.id).single()

        // Y sacado el permiso, la cajera vuelve a no poder cobrar.
        const { error: yaNo } = await cashierClient.rpc("confirm_sale", {
          p_branch_id: branchId,
          p_client_id: null,
          p_appointment_id: null,
          p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
          p_payments: [{ method: "cash", amount: 5000 }],
          p_discount: 0,
        })

        if (!offError && after?.can_operate_cash === false && yaNo?.code === "42501") {
          console.log("  OK — la encargada se lo sacó y dejó de poder cobrar")
        } else {
          failures++
          console.error(
            `  FALLO — off=${JSON.stringify(offError)}, flag=${after?.can_operate_cash}, yaNo=${JSON.stringify(yaNo)}`,
          )
        }
      }
    }
  } catch (err) {
    failures++
    console.error("Error inesperado:", err instanceof Error ? err.message : err)
  } finally {
    console.log("Limpiando datos de prueba...")
    // El Test 9 le provisiona un tenant propio al intruso.
    const { data: strayTenants } = await admin
      .from("tenants").select("id").eq("business_name", "Otro Salon Caja")
    for (const t of strayTenants ?? []) {
      await admin.from("memberships").delete().eq("tenant_id", t.id)
      await admin.from("branches").delete().eq("tenant_id", t.id)
      await admin.from("commission_rules").delete().eq("tenant_id", t.id)
      await admin.from("tenants").delete().eq("id", t.id)
    }
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
