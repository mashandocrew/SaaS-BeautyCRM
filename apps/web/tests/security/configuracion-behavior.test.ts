/**
 * Invariantes del módulo Configuración: sólo la dueña edita tenants
 * (business_name/settings) — tenants_update (0001) es estrictamente
 * owner-only, sin la excepción que sí tiene branches_update para la
 * encargada. Se confirma también que mergear settings no pisa claves
 * existentes.
 *
 * Ejecutar: pnpm test:configuracion (desde apps/web, con .env.local cargado)
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
  const email = `configuracion-test-${label}-${Date.now()}@example.com`
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
      p_business_name: "Configuracion Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    branchId = tenantRow[0].branch_id

    const supervisor = await createTestUser("supervisor")
    userIds.push(supervisor.id)
    await admin.from("memberships").insert({ tenant_id: tenantId, user_id: supervisor.id, branch_id: branchId, role: "supervisor" })
    const supervisorClient = await signIn(supervisor.email, supervisor.password)

    const operator = await createTestUser("operator")
    userIds.push(operator.id)
    await admin.from("memberships").insert({ tenant_id: tenantId, user_id: operator.id, branch_id: branchId, role: "operator" })
    const operatorClient = await signIn(operator.email, operator.password)

    // --- Test 1: la operadora no puede editar business_name ni settings ---
    console.log("Test 1: la operadora no puede editar el tenant...")
    {
      const { data } = await operatorClient
        .from("tenants")
        .update({ business_name: "Hackeado", settings: { currency: "USD" } })
        .eq("id", tenantId)
        .select("id")
      if ((data ?? []).length === 0) {
        console.log("  OK — bloqueado")
      } else {
        failures++
        console.error("  FALLO — la operadora pudo editar el tenant")
      }
    }

    // --- Test 2: la encargada tampoco puede (sin excepción, a diferencia de Sucursales) ---
    console.log("Test 2: la encargada tampoco puede editar el tenant...")
    {
      const { data } = await supervisorClient
        .from("tenants")
        .update({ business_name: "Hackeado por encargada" })
        .eq("id", tenantId)
        .select("id")
      if ((data ?? []).length === 0) {
        console.log("  OK — bloqueado")
      } else {
        failures++
        console.error("  FALLO — la encargada pudo editar el tenant")
      }
    }

    // --- Test 3: la dueña edita, y el merge de settings no pisa claves existentes ---
    console.log("Test 3: la dueña edita y el merge no pisa claves existentes...")
    {
      await admin.from("tenants").update({ settings: { branding: { logoUrl: "https://ejemplo.com/logo.png" } } }).eq("id", tenantId)

      const { data: current } = await ownerClient.from("tenants").select("settings").eq("id", tenantId).single()
      const merged = { ...(current!.settings as Record<string, unknown>), currency: "USD", timezone: "America/Argentina/Mendoza" }

      const { data, error } = await ownerClient
        .from("tenants")
        .update({ business_name: "Configuracion Test Salon Editado", settings: merged })
        .eq("id", tenantId)
        .select("business_name, settings")
        .maybeSingle()

      const settings = data?.settings as Record<string, unknown> | undefined
      const brandingSurvived = typeof settings?.branding === "object" && settings?.branding !== null
      const currencyUpdated = settings?.currency === "USD"

      if (!error && data?.business_name === "Configuracion Test Salon Editado" && brandingSurvived && currencyUpdated) {
        console.log("  OK — nombre y moneda actualizados, branding sobrevivió")
      } else {
        failures++
        console.error(`  FALLO — error=${error?.message}, data=${JSON.stringify(data)}`)
      }
    }

    // --- Test 4: aislamiento cross-tenant ---
    console.log("Test 4: un miembro de otro tenant no puede leer ni modificar tenants ajeno...")
    {
      const intruder = await createTestUser("intruder")
      userIds.push(intruder.id)
      const intruderClient = await signIn(intruder.email, intruder.password)
      await intruderClient.rpc("provision_tenant", { p_business_name: "Otro Salon Configuracion" })

      const { data: leaked } = await intruderClient.from("tenants").select("id").eq("id", tenantId)
      const { data: tampered } = await intruderClient.from("tenants").update({ business_name: "Hackeado" }).eq("id", tenantId).select("id")

      if ((leaked ?? []).length === 0 && (tampered ?? []).length === 0) {
        console.log("  OK — sin lectura ni escritura cruzada")
      } else {
        failures++
        console.error(`  FALLO — leaked=${leaked?.length}, tampered=${tampered?.length}`)
      }
    }
  } catch (err) {
    failures++
    console.error("Error inesperado:", err instanceof Error ? err.message : err)
  } finally {
    console.log("Limpiando datos de prueba...")
    const { data: strayTenants } = await admin.from("tenants").select("id").eq("business_name", "Otro Salon Configuracion")
    for (const t of strayTenants ?? []) {
      await admin.from("memberships").delete().eq("tenant_id", t.id)
      await admin.from("branches").delete().eq("tenant_id", t.id)
      await admin.from("commission_rules").delete().eq("tenant_id", t.id)
      await admin.from("tenants").delete().eq("id", t.id)
    }
    if (tenantId) {
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
    console.error(`\n${failures} test(s) de Configuración fallaron.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Configuración pasaron.")
}

main()
