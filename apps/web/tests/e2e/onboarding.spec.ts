import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del onboarding completo: registro → wizard (Pasos 0-4) → dashboard.
 *
 * No hay bandeja de email real en este entorno (Resend es Fase 2, Bloque
 * B.3), así que el "click al magic link" se simula con
 * admin.generateLink({ type: 'magiclink' }) — Supabase genera el mismo
 * action_link que mandaría por correo, y navegamos ahí directo. Es
 * equivalente a lo que haría un usuario real tocando el link del email.
 *
 * Corre contra el proyecto Supabase real con un usuario 100% descartable,
 * que se borra en el afterAll pase lo que pase.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const testEmail = `e2e-onboarding-${Date.now()}@example.com`
const businessName = `E2E Test Salon ${Date.now()}`
let userId: string | undefined
let tenantId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
    const { data: appointments } = await admin
      .from("appointments")
      .select("id")
      .eq("tenant_id", tenantId)
    const appointmentIds = (appointments ?? []).map((a) => a.id)
    if (appointmentIds.length > 0) {
      await admin.from("appointment_services").delete().in("appointment_id", appointmentIds)
    }
    await admin.from("client_history").delete().eq("tenant_id", tenantId)
    await admin.from("appointments").delete().eq("tenant_id", tenantId)
    await admin.from("clients").delete().eq("tenant_id", tenantId)
    await admin.from("services").delete().eq("tenant_id", tenantId)
    await admin.from("memberships").delete().eq("tenant_id", tenantId)
    await admin.from("branches").delete().eq("tenant_id", tenantId)
    await admin.from("commission_rules").delete().eq("tenant_id", tenantId)
    await admin.from("tenants").delete().eq("id", tenantId)
  }
  if (userId) {
    await admin.from("users").delete().eq("id", userId)
    await admin.auth.admin.deleteUser(userId)
  }
})

test.beforeAll(async ({ request }) => {
  // Next dev compila cada ruta on-demand la primera vez que se pide.
  // /auth/confirm nunca se visitó todavía en este arranque del server:
  // sin este "calentado" previo, la primera navegación real del test
  // puede abortar mientras el bundle todavía se está compilando.
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  await request.get(`${baseURL}/auth/confirm?type=magiclink`).catch(() => {})
})

test("registro → wizard completo → dashboard muestra el tenant nuevo", async ({ page }) => {
  // --- Paso 0 (parte auth): "registro" vía magic link simulado ---
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: testEmail,
    email_confirm: true,
  })
  expect(createError).toBeNull()
  userId = created?.user?.id

  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: testEmail,
  })
  expect(linkError).toBeNull()
  const tokenHash = linkData?.properties?.hashed_token
  expect(tokenHash).toBeTruthy()

  // Vamos directo a nuestra propia ruta de verificación (token_hash +
  // verifyOtp), no al link hosteado por Supabase — ese usa flujo
  // implícito (tokens en el fragmento #, que el servidor nunca ve) salvo
  // que el link se abra en el mismo navegador que inició el pedido.
  await page.goto(
    `${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/onboarding`,
    { waitUntil: "commit" }
  )
  await page.waitForURL(/\/onboarding$/)

  // --- Paso 0 (wizard): nombre del negocio → provision_tenant ---
  await expect(page.getByRole("heading", { name: "¿Cómo se llama tu negocio?" })).toBeVisible()
  await page.getByLabel("Nombre del negocio").fill(businessName)
  await page.getByRole("button", { name: "Crear mi negocio" }).click()

  // --- Paso 1: identidad — salteamos ---
  await expect(page.getByRole("heading", { name: "Identidad del negocio" })).toBeVisible()
  await page.getByRole("button", { name: "Saltear" }).click()

  // --- Paso 2: servicios — elegimos rubro y continuamos con la plantilla ---
  await expect(page.getByRole("heading", { name: "¿A qué rubro te dedicás?" })).toBeVisible()
  await page.getByRole("button", { name: "Nails" }).click()
  await page.getByRole("button", { name: /Continuar con \d+ servicios/ }).click()

  // --- Paso 3: equipo — sin invitar a nadie, continuamos ---
  await expect(page.getByRole("heading", { name: "¿Quién trabaja con vos?" })).toBeVisible()
  await page.getByRole("button", { name: "Continuar" }).click()

  // --- Paso 4: primer turno ---
  await expect(page.getByRole("heading", { name: "Cargá tu primer turno" })).toBeVisible()
  await page.getByLabel("Cliente").fill("Cliente E2E")
  await page.getByLabel("Teléfono").fill("+54 9 261 555-0000")
  await page.getByRole("button", { name: "Terminar — ¡listo!" }).click()

  // --- Dashboard: el tenant nuevo con su sucursal Principal ---
  await page.waitForURL("/dashboard")
  await expect(page.getByRole("heading", { name: `Hola, ${businessName}` })).toBeVisible()

  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("business_name", businessName)
    .maybeSingle()
  tenantId = tenant?.id
  expect(tenantId).toBeTruthy()

  const { data: branch } = await admin
    .from("branches")
    .select("name")
    .eq("tenant_id", tenantId!)
    .maybeSingle()

  expect(branch?.name).toBe("Principal")
})
