/**
 * Invariantes del módulo Clientes que conviene chequear a nivel de datos:
 * borrado restringido a owner/supervisor, edición de nota técnica
 * restringida a owner/supervisor, y que borrar un cliente con historial
 * falla por FK (a propósito, no un bug). Mismo patrón que
 * tests/security/agenda-behavior.test.ts: datos 100% descartables contra
 * el proyecto real, borrados en el finally.
 *
 * Ejecutar: pnpm test:clientes (desde apps/web, con .env.local cargado)
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
  const email = `clientes-test-${label}-${Date.now()}@example.com`
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
  let clientId: string | undefined
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Clientes Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id

    console.log("Creando operadora y cliente...")
    const operatorUser = await createTestUser("operator")
    userIds.push(operatorUser.id)
    const operatorClient = await signIn(operatorUser.email, operatorUser.password)

    const { error: membershipError } = await admin.from("memberships").insert({
      tenant_id: tenantId,
      user_id: operatorUser.id,
      branch_id: null,
      role: "operator",
    })
    if (membershipError) throw new Error(`No pude crear membership operador: ${membershipError.message}`)

    const { data: client, error: clientError } = await ownerClient
      .from("clients")
      .insert({ tenant_id: tenantId, full_name: "Cliente de prueba" })
      .select()
      .single()
    if (clientError || !client) throw new Error(`No pude crear cliente: ${clientError?.message}`)
    clientId = client.id

    const { data: historyRow, error: historyError } = await admin
      .from("client_history")
      .insert({ tenant_id: tenantId, client_id: clientId, operator_id: operatorUser.id, technical_notes: null })
      .select()
      .single()
    if (historyError || !historyRow) throw new Error(`No pude crear client_history: ${historyError?.message}`)

    // --- Test 1: operador no puede editar la nota técnica ---
    console.log("Test 1: operador no puede editar technical_notes...")
    const { data: operatorUpdate } = await operatorClient
      .from("client_history")
      .update({ technical_notes: "nota de operador" })
      .eq("id", historyRow.id)
      .select("id")
    if (operatorUpdate && operatorUpdate.length > 0) {
      console.error("  FALLO — el operador pudo editar la nota técnica")
      failures++
    } else {
      console.log("  OK — 0 filas afectadas (RLS bloqueó)")
    }

    // --- Test 2: dueño sí puede editar la nota técnica ---
    console.log("Test 2: el dueño puede editar technical_notes...")
    const { data: ownerUpdate, error: ownerUpdateError } = await ownerClient
      .from("client_history")
      .update({ technical_notes: "tono 7.3" })
      .eq("id", historyRow.id)
      .select("technical_notes")
      .maybeSingle()
    if (ownerUpdateError || ownerUpdate?.technical_notes !== "tono 7.3") {
      console.error("  FALLO — el dueño no pudo editar la nota técnica:", ownerUpdateError?.message)
      failures++
    } else {
      console.log("  OK — nota actualizada")
    }

    // --- Test 3: operador no puede borrar el cliente ---
    console.log("Test 3: operador no puede borrar un cliente...")
    const { data: operatorDelete } = await operatorClient.from("clients").delete().eq("id", clientId).select("id")
    const { data: stillThere } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle()
    if ((operatorDelete && operatorDelete.length > 0) || !stillThere) {
      console.error("  FALLO — el operador pudo borrar el cliente")
      failures++
    } else {
      console.log("  OK — 0 filas afectadas (RLS bloqueó), el cliente sigue existiendo")
    }

    // --- Test 4: el dueño no puede borrar un cliente con historial (FK) ---
    console.log("Test 4: borrar un cliente con historial falla por FK (a propósito)...")
    const { error: ownerDeleteError } = await ownerClient.from("clients").delete().eq("id", clientId)
    if (!ownerDeleteError) {
      console.error("  FALLO — se borró un cliente con client_history asociado, sin error de FK")
      failures++
    } else if (ownerDeleteError.code !== "23503") {
      console.error("  FALLO — falló pero con un código inesperado:", ownerDeleteError.code, ownerDeleteError.message)
      failures++
    } else {
      console.log("  OK — bloqueado por foreign_key_violation (23503)")
    }

    // --- Test 5: el dueño SÍ puede borrar un cliente sin historial ---
    console.log("Test 5: el dueño puede borrar un cliente sin historial...")
    const { data: freeClient, error: freeClientError } = await ownerClient
      .from("clients")
      .insert({ tenant_id: tenantId, full_name: "Cliente sin historial" })
      .select()
      .single()
    if (freeClientError || !freeClient) throw new Error(`No pude crear cliente sin historial: ${freeClientError?.message}`)

    const { data: freeDelete, error: freeDeleteError } = await ownerClient
      .from("clients")
      .delete()
      .eq("id", freeClient.id)
      .select("id")
      .maybeSingle()
    if (freeDeleteError || !freeDelete) {
      console.error("  FALLO — el dueño no pudo borrar un cliente sin historial:", freeDeleteError?.message)
      failures++
    } else {
      console.log("  OK — borrado")
    }
  } finally {
    console.log("Limpiando datos de prueba...")
    if (tenantId) {
      if (clientId) {
        await admin.from("client_history").delete().eq("client_id", clientId)
        await admin.from("clients").delete().eq("id", clientId)
      }
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
    console.error(`\n${failures} test(s) del módulo Clientes FALLARON.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Clientes pasaron.")
}

main().catch((err) => {
  console.error("Error inesperado en el test de Clientes:", err)
  process.exit(1)
})
