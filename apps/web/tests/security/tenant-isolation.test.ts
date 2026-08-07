/**
 * Test de aislamiento multi-tenant — LA garantía de toda la arquitectura
 * (Bloque A.1). Corre contra el proyecto Supabase real (no hay entorno de
 * staging separado en esta sesión) con datos 100% descartables: crea 2
 * usuarios + 2 tenants de prueba, verifica que RLS bloquea todo acceso
 * cruzado, y borra todo al final pase lo que pase (try/finally).
 *
 * Ejecutar: pnpm test:security  (desde apps/web, con .env.local cargado)
 */
import { createClient } from "@supabase/supabase-js"
import assert from "node:assert/strict"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltan env vars. Corré este test con apps/web/.env.local cargado (SUPABASE_SERVICE_ROLE_KEY incluido)."
  )
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type TestUser = { id: string; email: string; password: string }

async function createTestUser(label: string): Promise<TestUser> {
  const email = `rls-test-${label}-${Date.now()}@example.com`
  const password = `Test-${Math.random().toString(36).slice(2)}!`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`No pude crear usuario de prueba: ${error?.message}`)
  return { id: data.user.id, email, password }
}

async function signIn(user: TestUser) {
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error) throw new Error(`No pude loguear ${user.email}: ${error.message}`)
  return client
}

async function cleanup(userIds: string[], tenantIds: string[]) {
  // Orden que respeta las FK: hijos antes que padres.
  if (tenantIds.length > 0) {
    await admin.from("clients").delete().in("tenant_id", tenantIds)
    await admin.from("memberships").delete().in("tenant_id", tenantIds)
    await admin.from("branches").delete().in("tenant_id", tenantIds)
    await admin.from("tenants").delete().in("id", tenantIds)
  }
  for (const id of userIds) {
    await admin.from("users").delete().eq("id", id)
    await admin.auth.admin.deleteUser(id)
  }
}

async function main() {
  const userIds: string[] = []
  const tenantIds: string[] = []
  let failures = 0

  try {
    console.log("Creando usuarios de prueba...")
    const userA = await createTestUser("a")
    const userB = await createTestUser("b")
    userIds.push(userA.id, userB.id)

    const clientA = await signIn(userA)
    const clientB = await signIn(userB)

    console.log("Provisionando tenant A y tenant B...")
    const { data: tenantARow, error: tenantAError } = await clientA.rpc("provision_tenant", {
      p_business_name: "RLS Test Tenant A",
    })
    if (tenantAError || !tenantARow?.[0]) throw new Error(`provision_tenant A falló: ${tenantAError?.message}`)
    const tenantA = tenantARow[0]

    const { data: tenantBRow, error: tenantBError } = await clientB.rpc("provision_tenant", {
      p_business_name: "RLS Test Tenant B",
    })
    if (tenantBError || !tenantBRow?.[0]) throw new Error(`provision_tenant B falló: ${tenantBError?.message}`)
    const tenantB = tenantBRow[0]

    tenantIds.push(tenantA.tenant_id, tenantB.tenant_id)

    console.log("Cargando un cliente en el tenant B (como user B)...")
    const { data: clientRowB, error: insertClientBError } = await clientB
      .from("clients")
      .insert({ tenant_id: tenantB.tenant_id, full_name: "Cliente secreto de B" })
      .select()
      .single()
    if (insertClientBError || !clientRowB) {
      throw new Error(`No pude sembrar dato de B: ${insertClientBError?.message}`)
    }

    // --- Test 1: A no puede LEER clientes de B ---
    console.log("Test 1: A intenta leer clientes de B...")
    const { data: leakedRead, error: readError } = await clientA
      .from("clients")
      .select("*")
      .eq("id", clientRowB.id)

    if (readError) {
      console.log("  OK — la lectura devolvió error (bloqueada):", readError.message)
    } else if (!leakedRead || leakedRead.length === 0) {
      console.log("  OK — la lectura devolvió 0 filas (RLS bloqueó el acceso)")
    } else {
      console.error("  FALLO — A pudo leer un cliente del tenant B:", leakedRead)
      failures++
    }

    // --- Test 2: A no puede LEER el tenant B por selección directa ---
    console.log("Test 2: A intenta leer la fila del tenant B...")
    const { data: leakedTenant } = await clientA.from("tenants").select("*").eq("id", tenantB.tenant_id)
    assert.ok(
      !leakedTenant || leakedTenant.length === 0,
      "FALLO — A pudo leer la fila de tenants del tenant B"
    )
    console.log("  OK — 0 filas")

    // --- Test 3: A no puede ESCRIBIR en el tenant B ---
    console.log("Test 3: A intenta insertar un cliente en el tenant B...")
    const { error: writeError } = await clientA
      .from("clients")
      .insert({ tenant_id: tenantB.tenant_id, full_name: "Intento de fuga desde A" })

    if (!writeError) {
      console.error("  FALLO — A pudo insertar un cliente en el tenant B")
      failures++
    } else {
      console.log("  OK — el insert fue bloqueado:", writeError.message)
    }

    // --- Test 4: provision_tenant no es duplicable ---
    console.log("Test 4: A intenta provisionar un segundo tenant...")
    const { error: dupError } = await clientA.rpc("provision_tenant", {
      p_business_name: "Segundo negocio de A (no debería crearse)",
    })
    if (!dupError) {
      console.error("  FALLO — se permitió un segundo provision_tenant para el mismo owner")
      failures++
    } else if (!dupError.message.includes("ya es dueño de un tenant existente")) {
      console.error("  FALLO — provision_tenant fue bloqueado pero con un error inesperado:", dupError.message)
      failures++
    } else {
      console.log("  OK — bloqueado con el mensaje esperado")
    }
  } finally {
    console.log("Limpiando datos de prueba...")
    await cleanup(userIds, tenantIds)
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) de aislamiento FALLARON.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de aislamiento multi-tenant pasaron.")
}

main().catch((err) => {
  console.error("Error inesperado en el test de aislamiento:", err)
  process.exit(1)
})
