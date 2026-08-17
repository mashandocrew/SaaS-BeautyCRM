/**
 * Invariantes del módulo Inventario a nivel de datos: quién puede tocar los
 * catálogos, quién puede mover stock, y las dos garantías que sostienen el
 * historial — que el registro de movimientos es inmutable, y que el saldo
 * siempre coincide con la suma de los deltas.
 *
 * Mismo patrón que tests/security/servicios-behavior.test.ts: datos 100%
 * descartables contra el proyecto real, borrados en el finally.
 *
 * Ejecutar: pnpm test:inventario (desde apps/web, con .env.local cargado)
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
  const email = `inventario-test-${label}-${Date.now()}@example.com`
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
  let otherTenantId: string | undefined
  let otherBranchId: string | undefined
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Inventario Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    branchId = tenantRow[0].branch_id

    console.log("Creando operadora y supervisora...")
    const operator = await createTestUser("operator")
    userIds.push(operator.id)
    await admin.from("memberships").insert({
      tenant_id: tenantId, user_id: operator.id, branch_id: branchId, role: "operator",
    })
    const operatorClient = await signIn(operator.email, operator.password)

    const supervisor = await createTestUser("supervisor")
    userIds.push(supervisor.id)
    await admin.from("memberships").insert({
      tenant_id: tenantId, user_id: supervisor.id, branch_id: branchId, role: "supervisor",
    })
    const supervisorClient = await signIn(supervisor.email, supervisor.password)

    // --- Test 1: la operadora no puede crear insumos ni productos ---
    console.log("Test 1: la operadora no puede crear insumos ni productos...")
    const { data: opSupply } = await operatorClient
      .from("supplies")
      .insert({ tenant_id: tenantId, name: "Insumo de operadora", unit: "ml", cost_per_unit: 10 })
      .select("id")
    const { data: opProduct } = await operatorClient
      .from("retail_products")
      .insert({ tenant_id: tenantId, name: "Producto de operadora", sale_price: 100, cost: 50 })
      .select("id")
    if ((opSupply && opSupply.length > 0) || (opProduct && opProduct.length > 0)) {
      console.error("  FALLO — la operadora pudo crear en algún catálogo")
      failures++
    } else {
      console.log("  OK — RLS bloqueó ambos inserts")
    }

    // --- Test 2: la supervisora sí puede crear y editar ---
    console.log("Test 2: la supervisora puede crear y editar insumos...")
    const { data: supSupply, error: supSupplyError } = await supervisorClient
      .from("supplies")
      .insert({ tenant_id: tenantId, name: "Esmalte de supervisora", unit: "ml", cost_per_unit: 500 })
      .select("id")
      .single()
    if (supSupplyError || !supSupply) {
      console.error("  FALLO — la supervisora no pudo crear un insumo:", supSupplyError?.message)
      failures++
    } else {
      // Desde 0015 el costo no se puede releer por la tabla: los grants de
      // columna son por rol de base de datos, y dueña, encargada y operadora
      // comparten `authenticated`. Escribirlo sí se puede (revocamos select,
      // no update); leerlo va por inventory_costs, que chequea el rol.
      const { data: supUpdate, error: supUpdateError } = await supervisorClient
        .from("supplies")
        .update({ cost_per_unit: 600 })
        .eq("id", supSupply.id)
        .select("id")
        .maybeSingle()

      const { data: costs } = await supervisorClient.rpc("inventory_costs", {
        p_tenant_id: tenantId,
      })
      const elCosto = (costs ?? []).find((c: { item_id: string }) => c.item_id === supSupply.id)

      if (supUpdateError || !supUpdate || Number(elCosto?.cost) !== 600) {
        console.error(
          "  FALLO — la supervisora no pudo editar el insumo:",
          supUpdateError?.message ?? `costo leído: ${elCosto?.cost}`,
        )
        failures++
      } else {
        console.log("  OK — creó, editó, y releyó el costo por la vía autorizada")
      }
    }

    // El insumo con el que trabajan los tests de stock.
    const { data: supply, error: supplyError } = await ownerClient
      .from("supplies")
      .insert({ tenant_id: tenantId, name: "Esmalte rojo", unit: "ml", cost_per_unit: 800 })
      .select("id")
      .single()
    if (supplyError || !supply) throw new Error(`No pude crear el insumo base: ${supplyError?.message}`)

    // --- Test 3: la operadora no puede mover stock ---
    console.log("Test 3: la operadora no puede llamar a adjust_stock...")
    const { error: opAdjustError } = await operatorClient.rpc("adjust_stock", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_delta: 10, p_reason: "compra", p_note: null,
    })
    if (!opAdjustError) {
      console.error("  FALLO — la operadora pudo ajustar stock")
      failures++
    } else if (opAdjustError.code !== "42501") {
      console.error("  FALLO — falló con un código inesperado:", opAdjustError.code, opAdjustError.message)
      failures++
    } else {
      console.log("  OK — rechazada con 42501")
    }

    // --- Test 4: el ajuste que dejaría negativo se rechaza y no deja rastro ---
    console.log("Test 4: un ajuste que dejaría el stock negativo se rechaza sin dejar movimiento...")
    const { error: negativeError } = await ownerClient.rpc("adjust_stock", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_delta: -5, p_reason: "rotura", p_note: null,
    })
    const { count: movementsAfterNegative } = await admin
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("item_id", supply.id)
    if (!negativeError) {
      console.error("  FALLO — se aceptó un ajuste que deja el stock en negativo")
      failures++
    } else if ((movementsAfterNegative ?? 0) !== 0) {
      console.error("  FALLO — el ajuste rechazado igual dejó un movimiento")
      failures++
    } else {
      console.log("  OK — rechazado y sin movimiento")
    }

    // --- Test 5: el registro de movimientos es inmutable ---
    // Primero un movimiento legítimo para tener algo que intentar tocar.
    console.log("Test 5: inventory_movements no acepta escrituras directas...")
    const { error: buyError } = await ownerClient.rpc("adjust_stock", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_delta: 10, p_reason: "compra", p_note: "Primera compra",
    })
    if (buyError) throw new Error(`No pude registrar la compra inicial: ${buyError.message}`)

    const { data: movement } = await admin
      .from("inventory_movements")
      .select("id")
      .eq("item_id", supply.id)
      .limit(1)
      .maybeSingle()
    if (!movement) throw new Error("No encontré el movimiento de la compra inicial")

    const { data: forgedInsert } = await ownerClient
      .from("inventory_movements")
      .insert({
        tenant_id: tenantId, branch_id: branchId, item_id: supply.id, item_type: "supply",
        delta: 999, resulting_stock: 999, reason: "ajuste",
      })
      .select("id")
    const { data: forgedUpdate } = await ownerClient
      .from("inventory_movements")
      .update({ delta: 0 })
      .eq("id", movement.id)
      .select("id")
    const { data: forgedDelete } = await ownerClient
      .from("inventory_movements")
      .delete()
      .eq("id", movement.id)
      .select("id")
    if (
      (forgedInsert && forgedInsert.length > 0) ||
      (forgedUpdate && forgedUpdate.length > 0) ||
      (forgedDelete && forgedDelete.length > 0)
    ) {
      console.error("  FALLO — se pudo escribir inventory_movements directo (insert/update/delete)")
      failures++
    } else {
      console.log("  OK — las tres escrituras directas quedaron bloqueadas")
    }

    // --- Test 6: el saldo coincide con la suma de los deltas ---
    console.log("Test 6: el saldo coincide con la suma de los movimientos...")
    await ownerClient.rpc("adjust_stock", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_delta: -3, p_reason: "rotura", p_note: "Se cayó un frasco",
    })
    const { data: counted, error: countError } = await ownerClient.rpc("record_stock_count", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_counted: 5, p_note: "Recuento de fin de mes",
    })
    if (countError) {
      console.error("  FALLO — record_stock_count falló:", countError.message)
      failures++
    }

    const { data: inventoryRow } = await admin
      .from("inventory")
      .select("current_stock")
      .eq("branch_id", branchId)
      .eq("item_id", supply.id)
      .eq("item_type", "supply")
      .maybeSingle()
    const { data: allMovements } = await admin
      .from("inventory_movements")
      .select("delta, resulting_stock, created_at")
      .eq("item_id", supply.id)
      .order("created_at", { ascending: true })

    const sumOfDeltas = (allMovements ?? []).reduce((acc, m) => acc + Number(m.delta), 0)
    const lastResulting = Number((allMovements ?? []).at(-1)?.resulting_stock)
    const stock = Number(inventoryRow?.current_stock)

    if (Number(counted) !== 5) {
      console.error("  FALLO — record_stock_count devolvió", counted, "en vez de 5")
      failures++
    } else if (stock !== 5 || sumOfDeltas !== 5 || lastResulting !== 5) {
      console.error(
        `  FALLO — no cuadran: current_stock=${stock}, suma de deltas=${sumOfDeltas}, último resulting_stock=${lastResulting}`,
      )
      failures++
    } else {
      console.log("  OK — 10 − 3 + recuento a 5 → saldo 5, suma 5, resulting 5")
    }

    // --- Test 7: eliminar es owner-only y no borra el historial ---
    console.log("Test 7: la supervisora no puede eliminar; la dueña sí, sin perder movimientos...")
    const { error: supDeleteError } = await supervisorClient.rpc("soft_delete_inventory_item", {
      p_item_id: supply.id, p_item_type: "supply",
    })
    if (!supDeleteError || supDeleteError.code !== "42501") {
      console.error("  FALLO — la supervisora pudo eliminar (o falló con otro código):", supDeleteError?.code)
      failures++
    } else {
      const { error: ownerDeleteError } = await ownerClient.rpc("soft_delete_inventory_item", {
        p_item_id: supply.id, p_item_type: "supply",
      })
      const { data: deletedRow } = await admin
        .from("supplies")
        .select("deleted_at")
        .eq("id", supply.id)
        .maybeSingle()
      const { data: visible } = await ownerClient
        .from("v_inventory")
        .select("item_id")
        .eq("item_id", supply.id)
      const { count: movementsAfterDelete } = await admin
        .from("inventory_movements")
        .select("id", { count: "exact", head: true })
        .eq("item_id", supply.id)

      if (ownerDeleteError) {
        console.error("  FALLO — la dueña no pudo eliminar:", ownerDeleteError.message)
        failures++
      } else if (!deletedRow?.deleted_at) {
        console.error("  FALLO — el insumo no quedó marcado con deleted_at")
        failures++
      } else if (visible && visible.length > 0) {
        console.error("  FALLO — el insumo eliminado sigue apareciendo en v_inventory")
        failures++
      } else if ((movementsAfterDelete ?? 0) === 0) {
        console.error("  FALLO — se perdieron los movimientos al eliminar el insumo")
        failures++
      } else {
        console.log("  OK — supervisora bloqueada, dueña eliminó, historial intacto")
      }
    }

    // --- Test 8: aislamiento cross-tenant ---
    console.log("Test 8: un miembro de otro tenant no ve ni mueve stock ajeno...")
    const ownerB = await createTestUser("owner-b")
    userIds.push(ownerB.id)
    const ownerBClient = await signIn(ownerB.email, ownerB.password)
    const { data: tenantBRow, error: tenantBError } = await ownerBClient.rpc("provision_tenant", {
      p_business_name: "Inventario Test Salon B",
    })
    if (tenantBError || !tenantBRow?.[0]) throw new Error(`provision_tenant B falló: ${tenantBError?.message}`)
    otherTenantId = tenantBRow[0].tenant_id
    otherBranchId = tenantBRow[0].branch_id

    const { data: supplyA } = await ownerClient
      .from("supplies")
      .insert({ tenant_id: tenantId, name: "Insumo del tenant A", unit: "unit", cost_per_unit: 1 })
      .select("id")
      .single()

    const { error: crossAdjustError } = await ownerBClient.rpc("adjust_stock", {
      p_branch_id: otherBranchId, p_item_id: supplyA!.id, p_item_type: "supply",
      p_delta: 5, p_reason: "compra", p_note: null,
    })
    const { data: leaked } = await ownerBClient.from("v_inventory").select("item_id").eq("tenant_id", tenantId)
    const { data: leakedMovements } = await ownerBClient
      .from("inventory_movements")
      .select("id")
      .eq("tenant_id", tenantId)

    if (!crossAdjustError) {
      console.error("  FALLO — el dueño de otro tenant pudo ajustar stock de un ítem ajeno")
      failures++
    } else if ((leaked?.length ?? 0) > 0 || (leakedMovements?.length ?? 0) > 0) {
      console.error("  FALLO — se filtró inventario o movimientos de otro tenant")
      failures++
    } else {
      console.log("  OK — ajuste rechazado y sin filtración de lectura")
    }

    // --- Test 9: el costo no se lee sin permiso ---
    console.log("Test 9: la operadora no puede leer el costo, ni por la tabla ni por la vista...")
    {
      // Lo que se está cerrando: hoy supplies_select y retail_products_select
      // son de todo el tenant, así que una operadora con su sesión podía
      // pedir GET /rest/v1/supplies?select=cost_per_unit y le llegaba.
      const { data: viaTabla, error: tablaError } = await operatorClient
        .from("supplies")
        .select("cost_per_unit")
        .limit(1)

      const { data: viaVista, error: vistaError } = await operatorClient
        .from("v_inventory")
        .select("cost_per_unit")
        .limit(1)

      const tablaBloqueada = !!tablaError || (viaTabla ?? []).length === 0
      const vistaBloqueada = !!vistaError

      if (tablaBloqueada && vistaBloqueada) {
        console.log("  OK — el costo no llega por ninguno de los dos caminos")
      } else {
        failures++
        console.error(
          `  FALLO — tabla=${JSON.stringify(viaTabla ?? tablaError)}, vista=${JSON.stringify(viaVista ?? vistaError)}`,
        )
      }
    }

    // --- Test 10: quién sí obtiene el costo ---
    console.log("Test 10: dueña y encargada obtienen el costo; la operadora es rechazada...")
    {
      const { data: comoDuena, error: duenaError } = await ownerClient.rpc("inventory_costs", {
        p_tenant_id: tenantId,
      })
      const { error: comoEncargada } = await supervisorClient.rpc("inventory_costs", {
        p_tenant_id: tenantId,
      })
      const { error: comoOperadora } = await operatorClient.rpc("inventory_costs", {
        p_tenant_id: tenantId,
      })

      const duenaOk = !duenaError && (comoDuena ?? []).length > 0
      if (duenaOk && !comoEncargada && comoOperadora?.code === "42501") {
        console.log("  OK — dueña y encargada sí, operadora rechazada con 42501")
      } else {
        failures++
        console.error(
          `  FALLO — dueña=${JSON.stringify(duenaError ?? (comoDuena ?? []).length)}, encargada=${JSON.stringify(comoEncargada)}, operadora=${JSON.stringify(comoOperadora)}`,
        )
      }
    }
  } finally {
    console.log("Limpiando datos de prueba...")
    for (const tid of [tenantId, otherTenantId].filter((v): v is string => !!v)) {
      const { data: branches } = await admin.from("branches").select("id").eq("tenant_id", tid)
      const branchIds = (branches ?? []).map((b) => b.id)
      if (branchIds.length > 0) {
        await admin.from("inventory").delete().in("branch_id", branchIds)
      }
      await admin.from("inventory_movements").delete().eq("tenant_id", tid)
      await admin.from("supplies").delete().eq("tenant_id", tid)
      await admin.from("retail_products").delete().eq("tenant_id", tid)
      await admin.from("memberships").delete().eq("tenant_id", tid)
      await admin.from("branches").delete().eq("tenant_id", tid)
      await admin.from("commission_rules").delete().eq("tenant_id", tid)
      await admin.from("tenants").delete().eq("id", tid)
    }
    for (const id of userIds) {
      await admin.from("users").delete().eq("id", id)
      await admin.auth.admin.deleteUser(id)
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) del módulo Inventario FALLARON.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Inventario pasaron.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
