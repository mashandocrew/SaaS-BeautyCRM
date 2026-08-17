import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Sucursales: crear una segunda sucursal, pasar el tenant a
 * multi-sede, y ver que el selector de sucursal aparece en Agenda (Agenda
 * ya soporta modo multi — ver AgendaView.tsx).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-sucursales-owner-${Date.now()}@example.com`
const businessName = `E2E Sucursales Salon ${Date.now()}`

let ownerId: string | undefined
let operatorId: string | undefined
let tenantId: string | undefined
let originalBranchId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
    await admin.from("appointments").delete().eq("tenant_id", tenantId)
    await admin.from("memberships").delete().eq("tenant_id", tenantId)
    await admin.from("branches").delete().eq("tenant_id", tenantId)
    await admin.from("commission_rules").delete().eq("tenant_id", tenantId)
    await admin.from("tenants").delete().eq("id", tenantId)
  }
  for (const id of [ownerId, operatorId]) {
    if (!id) continue
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
  originalBranchId = tenantRow[0].branch_id

  // Agenda no renderiza su selector de sucursal si no hay operadoras
  // (EmptyState "Todavía no hay operadoras" reemplaza toda la vista) —
  // comportamiento propio de Agenda, no de este módulo. Se crea una para
  // poder ver el selector.
  const { data: operatorData, error: operatorError } = await admin.auth.admin.createUser({
    email: `e2e-sucursales-operator-${Date.now()}@example.com`,
    email_confirm: true,
  })
  if (operatorError || !operatorData.user) throw new Error(`No pude crear la operadora: ${operatorError?.message}`)
  operatorId = operatorData.user.id
  await admin.from("memberships").insert({
    tenant_id: tenantId,
    user_id: operatorId,
    branch_id: originalBranchId,
    role: "operator",
  })
})

test("crear sucursal, pasar a multi-sede, y ver el selector en Agenda", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/sucursales`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/sucursales$/)
  await expect(page.getByRole("heading", { name: "Sucursales", level: 1 })).toBeVisible()

  // Antes de crear la segunda, no hay selector de sucursal en Agenda.
  await page.goto(`${baseURL}/dashboard/agenda`)
  await expect(page.getByLabel("Elegir sucursal")).toHaveCount(0)

  // --- Crear la segunda sucursal ---
  await page.goto(`${baseURL}/dashboard/sucursales`)
  await page.getByRole("button", { name: "Nueva sucursal" }).click()
  await page.getByLabel("Nombre").fill("Sucursal Norte E2E")
  await page.getByRole("button", { name: "Crear sucursal" }).click()
  await expect(page.getByRole("cell", { name: "Sucursal Norte E2E" })).toBeVisible({ timeout: 15_000 })

  // --- Pasar a multi-sede ---
  page.once("dialog", (d) => d.accept())
  await page.getByRole("button", { name: "Pasar a multi-sede" }).click()
  await expect(page.getByText("Modo actual:")).toContainText("Multi-sede", { timeout: 15_000 })

  // --- El selector ahora aparece en Agenda ---
  // La dueña tiene branch_id = null (alcance global, por diseño de
  // provision_tenant), así que en modo multi sin ?branch= Agenda todavía
  // pide elegir sucursal (comportamiento propio de Agenda, no de este
  // módulo) — se navega con la sucursal original ya elegida para llegar a
  // la grilla y confirmar que el <select> está y lista ambas sucursales.
  await page.goto(`${baseURL}/dashboard/agenda?branch=${originalBranchId}`)
  await expect(page.getByLabel("Elegir sucursal")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel("Elegir sucursal").locator("option", { hasText: "Sucursal Norte E2E" })).toHaveCount(1)
})
