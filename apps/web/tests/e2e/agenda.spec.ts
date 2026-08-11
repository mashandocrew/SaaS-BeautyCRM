import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Agenda: alta de turno desde el modal y bloqueo de
 * doble-booking visible en la UI. Mismo patrón que onboarding.spec.ts:
 * tenant 100% descartable, provisionado a mano (acá se prueba Agenda, no
 * el wizard de onboarding).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-agenda-owner-${Date.now()}@example.com`
const businessName = `E2E Agenda Salon ${Date.now()}`

let ownerId: string | undefined
let operatorId: string | undefined
let tenantId: string | undefined

test.afterAll(async () => {
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
  for (const id of [ownerId, operatorId].filter((v): v is string => !!v)) {
    await admin.from("users").delete().eq("id", id)
    await admin.auth.admin.deleteUser(id)
  }
})

test.beforeAll(async ({ request }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  await request.get(`${baseURL}/auth/confirm?type=magiclink`).catch(() => {})

  const { data: ownerData, error: ownerError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
  })
  if (ownerError || !ownerData.user) throw new Error(`No pude crear el owner: ${ownerError?.message}`)
  ownerId = ownerData.user.id

  const ownerAnon = createClient(SUPABASE_URL, ANON_KEY)
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const hashedToken = linkData?.properties?.hashed_token
  if (!hashedToken) throw new Error("No pude generar el magic link del owner")

  const { error: verifyError } = await ownerAnon.auth.verifyOtp({ type: "magiclink", token_hash: hashedToken })
  if (verifyError) throw new Error(`No pude verificar el magic link: ${verifyError.message}`)

  const { data: tenantRow, error: tenantError } = await ownerAnon.rpc("provision_tenant", {
    p_business_name: businessName,
  })
  if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
  tenantId = tenantRow[0].tenant_id
  const branchId = tenantRow[0].branch_id

  const { data: operatorData, error: operatorError } = await admin.auth.admin.createUser({
    email: `e2e-agenda-operator-${Date.now()}@example.com`,
    email_confirm: true,
  })
  if (operatorError || !operatorData.user) throw new Error(`No pude crear la operadora: ${operatorError?.message}`)
  operatorId = operatorData.user.id
  await admin.from("users").update({ full_name: "Operadora E2E" }).eq("id", operatorId)

  const { error: membershipError } = await admin.from("memberships").insert({
    tenant_id: tenantId,
    user_id: operatorId,
    branch_id: branchId,
    role: "operator",
  })
  if (membershipError) throw new Error(`No pude crear la membership de la operadora: ${membershipError.message}`)

  const { error: serviceError } = await admin
    .from("services")
    .insert({ tenant_id: tenantId, name: "Manicura E2E", duration_minutes: 60, price: 5000, is_active: true })
  if (serviceError) throw new Error(`No pude crear el servicio: ${serviceError.message}`)
})

test("crear turno desde el modal y bloquear el doble-booking con mensaje legible", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/agenda`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/agenda$/)
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible()

  // --- Turno 1: alta desde el modal ---
  await page.locator(".agenda-grid-slot").first().click()
  await expect(page.getByRole("heading", { name: "Nuevo turno" })).toBeVisible()

  await page.getByPlaceholder("Buscar por nombre o teléfono...").fill("Cliente E2E Agenda")
  await page.getByRole("button", { name: "+ Crear cliente nuevo" }).click()
  await page.getByLabel("Teléfono").fill("+54 9 261 555-1111")
  await page.getByRole("button", { name: "Crear y usar este cliente" }).click()

  await page.locator("#agenda-services").getByText("Manicura E2E").click()
  await page.getByRole("dialog").getByLabel("Operadora").selectOption({ label: "Operadora E2E" })

  const conflictingTime = await page.getByLabel("Hora").inputValue()

  await page.getByRole("button", { name: "Crear turno" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo turno" })).toBeHidden()
  // router.refresh() re-pide los datos del server component: puede tardar
  // un poco más que el timeout por default en una máquina con carga.
  await expect(page.getByText("Cliente E2E Agenda")).toBeVisible({ timeout: 10_000 })

  // --- Turno 2: mismo horario, misma operadora → bloqueado en la UI ---
  await page.locator(".agenda-grid-slot").last().click()
  await expect(page.getByRole("heading", { name: "Nuevo turno" })).toBeVisible()

  await page.getByPlaceholder("Buscar por nombre o teléfono...").fill("Cliente E2E Agenda")
  await page.getByRole("dialog").getByRole("button", { name: /Cliente E2E Agenda/ }).click()
  await page.locator("#agenda-services").getByText("Manicura E2E").click()
  await page.getByRole("dialog").getByLabel("Operadora").selectOption({ label: "Operadora E2E" })
  await page.getByLabel("Hora").fill(conflictingTime)

  await expect(page.getByText("Esa persona ya tiene un turno en ese horario.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Crear turno" })).toBeDisabled()
})
