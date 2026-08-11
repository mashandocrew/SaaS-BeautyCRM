/**
 * Invariantes del módulo Agenda que conviene chequear a nivel de datos, no
 * solo de UI: bloqueo de doble-booking, price_snapshot congelado, alta
 * automática en client_history al completar, y aislamiento operadora vs
 * operadora. Mismo patrón que tests/security/tenant-isolation.test.ts:
 * datos 100% descartables contra el proyecto real, borrados en el finally.
 *
 * Ejecutar: pnpm test:agenda (desde apps/web, con .env.local cargado)
 */
import { createClient } from "@supabase/supabase-js"
import assert from "node:assert/strict"

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
  const email = `agenda-test-${label}-${Date.now()}@example.com`
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
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Agenda Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    const branchId = tenantRow[0].branch_id

    console.log("Creando operadora, servicio y cliente...")
    const operatorUser = await createTestUser("operator")
    userIds.push(operatorUser.id)
    const operatorClient = await signIn(operatorUser.email, operatorUser.password)

    const { error: membershipError } = await admin.from("memberships").insert({
      tenant_id: tenantId,
      user_id: operatorUser.id,
      branch_id: branchId,
      role: "operator",
    })
    if (membershipError) throw new Error(`No pude crear membership operador: ${membershipError.message}`)

    const { data: service, error: serviceError } = await ownerClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Manicura", duration_minutes: 60, price: 5000 })
      .select()
      .single()
    if (serviceError || !service) throw new Error(`No pude crear servicio: ${serviceError?.message}`)

    const { data: client, error: clientError } = await ownerClient
      .from("clients")
      .insert({ tenant_id: tenantId, full_name: "Cliente de prueba" })
      .select()
      .single()
    if (clientError || !client) throw new Error(`No pude crear cliente: ${clientError?.message}`)

    // --- Test 1: OPERATOR_BUSY bloquea el doble-booking ---
    console.log("Test 1: doble-booking del mismo operador...")
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const { data: firstBooking, error: firstError } = await operatorClient.rpc("book_appointment", {
      p_branch_id: branchId,
      p_client_id: client.id,
      p_operator_id: operatorUser.id,
      p_starts_at: startsAt,
      p_service_ids: [service.id],
    })
    if (firstError || !firstBooking?.[0]) throw new Error(`Primer turno falló: ${firstError?.message}`)
    const appointmentId = firstBooking[0].appointment_id

    const { error: secondError } = await operatorClient.rpc("book_appointment", {
      p_branch_id: branchId,
      p_client_id: client.id,
      p_operator_id: operatorUser.id,
      p_starts_at: startsAt,
      p_service_ids: [service.id],
    })
    if (!secondError) {
      console.error("  FALLO — se permitió un turno solapado para el mismo operador")
      failures++
    } else if (!secondError.message.includes("OPERATOR_BUSY")) {
      console.error("  FALLO — se bloqueó pero con un error inesperado:", secondError.message)
      failures++
    } else {
      console.log("  OK — bloqueado con OPERATOR_BUSY")
    }

    // --- Test 2: price_snapshot queda congelado ---
    console.log("Test 2: price_snapshot no cambia si el precio del servicio cambia después...")
    await ownerClient.from("services").update({ price: 9999 }).eq("id", service.id)
    const { data: snapshotRow } = await admin
      .from("appointment_services")
      .select("price_snapshot")
      .eq("appointment_id", appointmentId)
      .eq("service_id", service.id)
      .single()
    assert.equal(
      Number(snapshotRow?.price_snapshot),
      5000,
      "FALLO — price_snapshot cambió con el precio del catálogo"
    )
    console.log("  OK — price_snapshot sigue en 5000")

    // --- Test 3: al completar el turno, aparece en client_history ---
    console.log("Test 3: marcar 'done' genera client_history automáticamente...")
    const { error: doneError } = await operatorClient
      .from("appointments")
      .update({ status: "done" })
      .eq("id", appointmentId)
    if (doneError) throw new Error(`No pude marcar el turno como done: ${doneError.message}`)

    const { data: historyRows } = await admin
      .from("client_history")
      .select("id, service_id")
      .eq("appointment_id", appointmentId)
    assert.ok(
      historyRows && historyRows.some((h) => h.service_id === service.id),
      "FALLO — no se generó client_history al completar el turno"
    )
    console.log("  OK — client_history generado")

    // --- Test 4: una operadora no ve turnos de otra en v_agenda ---
    console.log("Test 4: aislamiento entre operadoras...")
    const otherOperator = await createTestUser("operator-b")
    userIds.push(otherOperator.id)
    const otherClient = await signIn(otherOperator.email, otherOperator.password)
    const { error: otherMembershipError } = await admin.from("memberships").insert({
      tenant_id: tenantId,
      user_id: otherOperator.id,
      branch_id: branchId,
      role: "operator",
    })
    if (otherMembershipError) throw new Error(`No pude crear membership B: ${otherMembershipError.message}`)

    const { data: leaked } = await otherClient.from("v_agenda").select("id").eq("id", appointmentId)
    assert.ok(!leaked || leaked.length === 0, "FALLO — la operadora B pudo ver el turno de la operadora A")
    console.log("  OK — 0 filas visibles para la operadora B")
  } finally {
    console.log("Limpiando datos de prueba...")
    if (tenantId) {
      const { data: appts } = await admin.from("appointments").select("id").eq("tenant_id", tenantId)
      const apptIds = (appts ?? []).map((a) => a.id)
      if (apptIds.length > 0) {
        await admin.from("appointment_services").delete().in("appointment_id", apptIds)
        await admin.from("client_history").delete().in("appointment_id", apptIds)
      }
      await admin.from("appointments").delete().eq("tenant_id", tenantId)
      await admin.from("clients").delete().eq("tenant_id", tenantId)
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
    console.error(`\n${failures} test(s) del módulo Agenda FALLARON.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Agenda pasaron.")
}

main().catch((err) => {
  console.error("Error inesperado en el test de Agenda:", err)
  process.exit(1)
})
