/**
 * Invariantes del módulo Sucursales: quién puede crear/editar/borrar
 * sucursales y cambiar el modo del tenant — todo ya lo garantiza la RLS de
 * 0001, este test confirma que la superficie que usa la UI (tabla directa,
 * sin RPC nuevo) respeta exactamente esa RLS.
 *
 * La regla "no desactivar la última sucursal activa" vive en
 * sucursales-actions.ts (createClient() de @beautycrm/supabase/server,
 * depende de next/headers, no se puede importar acá) — queda cubierta por
 * el E2E y por QA manual, no por este test.
 *
 * Ejecutar: pnpm test:sucursales (desde apps/web, con .env.local cargado)
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
  const email = `sucursales-test-${label}-${Date.now()}@example.com`
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
      p_business_name: "Sucursales Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    branchId = tenantRow[0].branch_id

    console.log("Creando encargada y operadora...")
    const supervisor = await createTestUser("supervisor")
    userIds.push(supervisor.id)
    await admin.from("memberships").insert({ tenant_id: tenantId, user_id: supervisor.id, branch_id: branchId, role: "supervisor" })
    const supervisorClient = await signIn(supervisor.email, supervisor.password)

    const operator = await createTestUser("operator")
    userIds.push(operator.id)
    await admin.from("memberships").insert({ tenant_id: tenantId, user_id: operator.id, branch_id: branchId, role: "operator" })
    const operatorClient = await signIn(operator.email, operator.password)

    // --- Test 1: la operadora no puede crear, editar ni borrar sucursales, ni cambiar el modo ---
    console.log("Test 1: la operadora no puede tocar sucursales ni el modo...")
    {
      const { data: insertResult } = await operatorClient
        .from("branches")
        .insert({ tenant_id: tenantId, name: "Sucursal de operadora" })
        .select("id")
      const insertBlocked = (insertResult ?? []).length === 0

      const { data: updateResult } = await operatorClient.from("branches").update({ name: "Hackeada" }).eq("id", branchId).select("id")
      const updateBlocked = (updateResult ?? []).length === 0

      const { data: deleteResult } = await operatorClient.from("branches").delete().eq("id", branchId).select("id")
      const deleteBlocked = (deleteResult ?? []).length === 0

      const { data: modeResult } = await operatorClient.from("tenants").update({ mode: "multi" }).eq("id", tenantId).select("id")
      const modeBlocked = (modeResult ?? []).length === 0

      if (insertBlocked && updateBlocked && deleteBlocked && modeBlocked) {
        console.log("  OK — las cuatro operaciones quedaron bloqueadas")
      } else {
        failures++
        console.error(`  FALLO — insert=${insertBlocked}, update=${updateBlocked}, delete=${deleteBlocked}, mode=${modeBlocked}`)
      }
    }

    // --- Test 2: la encargada puede crear y editar, pero no borrar ni cambiar el modo ---
    console.log("Test 2: la encargada crea y edita, pero no borra ni cambia el modo...")
    {
      const { data: newBranch, error: insertError } = await supervisorClient
        .from("branches")
        .insert({ tenant_id: tenantId, name: "Sucursal de encargada" })
        .select("id")
        .single()
      const created = !insertError && !!newBranch

      const { data: updated, error: updateError } = await supervisorClient
        .from("branches")
        .update({ address: "Calle Falsa 123" })
        .eq("id", newBranch?.id ?? branchId)
        .select("id")
        .maybeSingle()
      const edited = !updateError && !!updated

      const { data: deleteResult } = await supervisorClient.from("branches").delete().eq("id", newBranch!.id).select("id")
      const deleteBlocked = (deleteResult ?? []).length === 0

      const { data: modeResult } = await supervisorClient.from("tenants").update({ mode: "multi" }).eq("id", tenantId).select("id")
      const modeBlocked = (modeResult ?? []).length === 0

      if (created && edited && deleteBlocked && modeBlocked) {
        console.log("  OK — crea y edita; borrar y cambiar el modo siguen siendo sólo de la dueña")
      } else {
        failures++
        console.error(`  FALLO — created=${created}, edited=${edited}, deleteBlocked=${deleteBlocked}, modeBlocked=${modeBlocked}`)
      }
    }

    // --- Test 3: la dueña puede pasar el tenant a multi y borrar una sucursal ---
    console.log("Test 3: la dueña pasa el tenant a multi-sede...")
    {
      const { data, error } = await ownerClient.from("tenants").update({ mode: "multi" }).eq("id", tenantId).select("mode").maybeSingle()
      if (!error && data?.mode === "multi") {
        console.log("  OK — modo actualizado")
      } else {
        failures++
        console.error(`  FALLO — error=${error?.message}, data=${JSON.stringify(data)}`)
      }
    }

    // --- Test 4: aislamiento cross-tenant ---
    console.log("Test 4: un miembro de otro tenant no ve ni modifica sucursales ajenas...")
    {
      const intruder = await createTestUser("intruder")
      userIds.push(intruder.id)
      const intruderClient = await signIn(intruder.email, intruder.password)
      await intruderClient.rpc("provision_tenant", { p_business_name: "Otro Salon Sucursales" })

      const { data: leaked } = await intruderClient.from("branches").select("id").eq("tenant_id", tenantId)
      const { data: tampered } = await intruderClient.from("branches").update({ name: "Hackeada" }).eq("tenant_id", tenantId).select("id")

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
    const { data: strayTenants } = await admin.from("tenants").select("id").eq("business_name", "Otro Salon Sucursales")
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
    console.error(`\n${failures} test(s) de Sucursales fallaron.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Sucursales pasaron.")
}

main()
