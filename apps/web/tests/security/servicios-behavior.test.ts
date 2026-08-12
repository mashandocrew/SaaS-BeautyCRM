/**
 * Invariantes del módulo Servicios a nivel de datos: quién puede crear,
 * editar y borrar un servicio, y qué pasa al borrar uno que ya se usó en
 * un turno. Mismo patrón que tests/security/clientes-behavior.test.ts:
 * datos 100% descartables contra el proyecto real, borrados en el finally.
 *
 * OJO: services_delete es owner-only (migrations/0001_initial_schema.sql),
 * más estricto que clients_delete (owner o supervisor). El Test 4 fija esa
 * asimetría a propósito — si algún día se relaja la policy, este test
 * falla y obliga a revisar también el frontend, que hoy le esconde el
 * botón "Eliminar servicio" al supervisor.
 *
 * Ejecutar: pnpm test:servicios (desde apps/web, con .env.local cargado)
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
  const email = `servicios-test-${label}-${Date.now()}@example.com`
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
      p_business_name: "Servicios Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    branchId = tenantRow[0].branch_id

    console.log("Creando operadora y supervisora...")
    const operatorUser = await createTestUser("operator")
    userIds.push(operatorUser.id)
    const operatorClient = await signIn(operatorUser.email, operatorUser.password)

    const supervisorUser = await createTestUser("supervisor")
    userIds.push(supervisorUser.id)
    const supervisorClient = await signIn(supervisorUser.email, supervisorUser.password)

    const { error: membershipError } = await admin.from("memberships").insert([
      { tenant_id: tenantId, user_id: operatorUser.id, branch_id: null, role: "operator" },
      { tenant_id: tenantId, user_id: supervisorUser.id, branch_id: null, role: "supervisor" },
    ])
    if (membershipError) throw new Error(`No pude crear memberships: ${membershipError.message}`)

    const { data: baseService, error: baseServiceError } = await ownerClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Corte base", duration_minutes: 45, price: 12000, category: "Cabello" })
      .select()
      .single()
    if (baseServiceError || !baseService) throw new Error(`No pude crear servicio base: ${baseServiceError?.message}`)

    // --- Test 1: operador no puede crear un servicio ---
    console.log("Test 1: operador no puede crear un servicio...")
    const { data: operatorInsert, error: operatorInsertError } = await operatorClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Servicio de operadora", duration_minutes: 30, price: 5000 })
      .select("id")
    if (!operatorInsertError && operatorInsert && operatorInsert.length > 0) {
      console.error("  FALLO — el operador pudo crear un servicio")
      failures++
    } else {
      console.log("  OK — RLS bloqueó el insert")
    }

    // --- Test 2: operador no puede editar un servicio ---
    console.log("Test 2: operador no puede editar un servicio...")
    const { data: operatorUpdate } = await operatorClient
      .from("services")
      .update({ price: 1 })
      .eq("id", baseService.id)
      .select("id")
    if (operatorUpdate && operatorUpdate.length > 0) {
      console.error("  FALLO — el operador pudo editar un servicio")
      failures++
    } else {
      console.log("  OK — 0 filas afectadas (RLS bloqueó)")
    }

    // --- Test 3: supervisor sí puede crear y editar ---
    console.log("Test 3: supervisor puede crear y editar servicios...")
    const { data: supervisorService, error: supervisorInsertError } = await supervisorClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Servicio de supervisora", duration_minutes: 60, price: 15000 })
      .select()
      .single()
    if (supervisorInsertError || !supervisorService) {
      console.error("  FALLO — la supervisora no pudo crear un servicio:", supervisorInsertError?.message)
      failures++
    } else {
      const { data: supervisorUpdate, error: supervisorUpdateError } = await supervisorClient
        .from("services")
        .update({ price: 16000 })
        .eq("id", supervisorService.id)
        .select("price")
        .maybeSingle()
      if (supervisorUpdateError || Number(supervisorUpdate?.price) !== 16000) {
        console.error("  FALLO — la supervisora no pudo editar el servicio:", supervisorUpdateError?.message)
        failures++
      } else {
        console.log("  OK — creó y editó")
      }
    }

    // --- Test 4: supervisor NO puede borrar (services_delete es owner-only) ---
    console.log("Test 4: supervisor no puede borrar un servicio...")
    const { data: throwaway, error: throwawayError } = await ownerClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Servicio descartable", duration_minutes: 15, price: 1000 })
      .select()
      .single()
    if (throwawayError || !throwaway) throw new Error(`No pude crear servicio descartable: ${throwawayError?.message}`)

    const { data: supervisorDelete } = await supervisorClient
      .from("services")
      .delete()
      .eq("id", throwaway.id)
      .select("id")
    const { data: stillThere } = await admin.from("services").select("id").eq("id", throwaway.id).maybeSingle()
    if ((supervisorDelete && supervisorDelete.length > 0) || !stillThere) {
      console.error("  FALLO — la supervisora pudo borrar un servicio (services_delete debería ser owner-only)")
      failures++
    } else {
      console.log("  OK — 0 filas afectadas (RLS bloqueó), el servicio sigue existiendo")
    }

    // --- Test 5: owner sí puede borrar un servicio sin uso ---
    // Fila propia y no la de Test 4: si services_delete se afloja, Test 4
    // ya borró aquella y Test 5 reportaría un fallo falso ("el dueño no
    // pudo borrar") por una fila inexistente, escondiendo cuál es el bug real.
    console.log("Test 5: el dueño puede borrar un servicio sin uso...")
    const { data: unusedService, error: unusedServiceError } = await ownerClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Servicio sin uso", duration_minutes: 20, price: 2000 })
      .select()
      .single()
    if (unusedServiceError || !unusedService) {
      throw new Error(`No pude crear servicio sin uso: ${unusedServiceError?.message}`)
    }

    const { data: ownerDelete, error: ownerDeleteError } = await ownerClient
      .from("services")
      .delete()
      .eq("id", unusedService.id)
      .select("id")
      .maybeSingle()
    if (ownerDeleteError || !ownerDelete) {
      console.error("  FALLO — el dueño no pudo borrar un servicio sin uso:", ownerDeleteError?.message)
      failures++
    } else {
      console.log("  OK — borrado")
    }

    // --- Test 6: borrar un servicio usado en un turno falla por FK ---
    console.log("Test 6: borrar un servicio ya usado en un turno falla por FK (a propósito)...")
    const { data: client, error: clientError } = await ownerClient
      .from("clients")
      .insert({ tenant_id: tenantId, full_name: "Cliente de prueba servicios" })
      .select()
      .single()
    if (clientError || !client) throw new Error(`No pude crear cliente: ${clientError?.message}`)

    const startsAt = new Date(Date.now() + 3600_000).toISOString()
    const endsAt = new Date(Date.now() + 3600_000 + 45 * 60_000).toISOString()
    const { data: appointment, error: appointmentError } = await admin
      .from("appointments")
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        client_id: client.id,
        operator_id: operatorUser.id,
        starts_at: startsAt,
        ends_at: endsAt,
      })
      .select()
      .single()
    if (appointmentError || !appointment) throw new Error(`No pude crear turno: ${appointmentError?.message}`)

    const { error: linkError } = await admin
      .from("appointment_services")
      .insert({ appointment_id: appointment.id, service_id: baseService.id, price_snapshot: 12000 })
    if (linkError) throw new Error(`No pude vincular servicio al turno: ${linkError.message}`)

    const { error: usedDeleteError } = await ownerClient.from("services").delete().eq("id", baseService.id)
    if (!usedDeleteError) {
      console.error("  FALLO — se borró un servicio con appointment_services asociado, sin error de FK")
      failures++
    } else if (usedDeleteError.code !== "23503") {
      console.error("  FALLO — falló pero con un código inesperado:", usedDeleteError.code, usedDeleteError.message)
      failures++
    } else {
      console.log("  OK — bloqueado por foreign_key_violation (23503)")
    }
  } finally {
    console.log("Limpiando datos de prueba...")
    if (tenantId) {
      // Borramos por tenant_id (no solo por los ids que veníamos trackeando)
      // para no dejar basura si algún assert tira antes de registrar un id —
      // mismo patrón defensivo que clientes-behavior.test.ts. El orden
      // respeta las FK: primero lo que referencia, después lo referenciado.
      const { data: appointments } = await admin.from("appointments").select("id").eq("tenant_id", tenantId)
      const appointmentIds = (appointments ?? []).map((a) => a.id)
      if (appointmentIds.length > 0) {
        await admin.from("appointment_services").delete().in("appointment_id", appointmentIds)
      }
      await admin.from("client_history").delete().eq("tenant_id", tenantId)
      await admin.from("appointments").delete().eq("tenant_id", tenantId)
      await admin.from("services").delete().eq("tenant_id", tenantId)
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
    console.error(`\n${failures} test(s) del módulo Servicios FALLARON.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Servicios pasaron.")
}

main().catch((err) => {
  console.error("Error inesperado en el test de Servicios:", err)
  process.exit(1)
})
