import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Configuración: la dueña cambia el nombre del negocio y se
 * refleja en el Sidebar sin recargar manualmente.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-configuracion-owner-${Date.now()}@example.com`
const businessName = `E2E Configuracion Salon ${Date.now()}`

let ownerId: string | undefined
let tenantId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
    await admin.from("memberships").delete().eq("tenant_id", tenantId)
    await admin.from("branches").delete().eq("tenant_id", tenantId)
    await admin.from("commission_rules").delete().eq("tenant_id", tenantId)
    await admin.from("tenants").delete().eq("id", tenantId)
  }
  if (ownerId) {
    await admin.from("users").delete().eq("id", ownerId)
    await admin.auth.admin.deleteUser(ownerId)
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
})

test("cambia el nombre del negocio y se refleja en el Sidebar", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/configuracion`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/configuracion$/)
  await expect(page.getByRole("heading", { name: "Configuración", exact: true })).toBeVisible()
  await expect(page.locator(".sidebar-brand-sub")).toHaveText(businessName)

  const newName = "Salón Renombrado E2E"
  await page.getByLabel("Nombre del salón").fill(newName)
  await page.getByLabel("Moneda").selectOption("USD")
  await page.getByRole("button", { name: "Guardar cambios" }).click()

  await expect(page.getByText("Guardado.")).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(".sidebar-brand-sub")).toHaveText(newName)
})
