import { test, expect } from "@playwright/test"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Comisiones: la dueña crea una regla, se la asigna a una
 * operadora, la operadora cobra (vía RPC, el flujo de Caja ya tiene su
 * propio E2E), la dueña ve el devengado y liquida el período.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-comisiones-owner-${Date.now()}@example.com`
const businessName = `E2E Comisiones Salon ${Date.now()}`

let ownerId: string | undefined
let operatorId: string | undefined
let tenantId: string | undefined
let branchId: string | undefined
let serviceId: string | undefined
let ownerAnon: SupabaseClient | undefined

test.afterAll(async () => {
  if (tenantId) {
    const { data: sales } = await admin.from("sales").select("id").eq("tenant_id", tenantId)
    const saleIds = (sales ?? []).map((s) => s.id)
    await admin.from("commission_ledger").delete().eq("tenant_id", tenantId)
    if (saleIds.length > 0) {
      await admin.from("payments").delete().in("sale_id", saleIds)
      await admin.from("sale_items").delete().in("sale_id", saleIds)
    }
    await admin.from("sales").delete().eq("tenant_id", tenantId)
    await admin.from("cash_sessions").delete().eq("tenant_id", tenantId)
    await admin.from("services").delete().eq("tenant_id", tenantId)
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

  ownerAnon = createClient(SUPABASE_URL, ANON_KEY)
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
  branchId = tenantRow[0].branch_id

  const { data: operatorData, error: operatorError } = await admin.auth.admin.createUser({
    email: `e2e-comisiones-operator-${Date.now()}@example.com`,
    email_confirm: true,
  })
  if (operatorError || !operatorData.user) throw new Error(`No pude crear la operadora: ${operatorError?.message}`)
  operatorId = operatorData.user.id
  await admin.from("users").update({ full_name: "Operadora E2E" }).eq("id", operatorId)
  await admin.from("memberships").insert({
    tenant_id: tenantId,
    user_id: operatorId,
    branch_id: branchId,
    role: "operator",
  })

  const { data: service } = await ownerAnon
    .from("services")
    .insert({ tenant_id: tenantId, name: "Corte Comisiones E2E", price: 8000, duration_minutes: 30 })
    .select("id")
    .single()
  serviceId = service!.id
})

test("crear regla, asignarla, cobrar y liquidar el período", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/comisiones`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/comisiones$/)
  await expect(page.getByRole("heading", { name: "Comisiones", exact: true })).toBeVisible()

  // --- Crear regla ---
  await page.getByRole("button", { name: "Nueva regla" }).click()
  await page.getByLabel("Nombre").fill("Regla E2E")
  await page.getByLabel("% sobre servicios").fill("20")
  await page.getByRole("button", { name: "Crear regla" }).click()
  await expect(page.getByRole("cell", { name: "Regla E2E" })).toBeVisible({ timeout: 15_000 })

  // --- Asignarla a la operadora ---
  await page.getByLabel("Regla de comisión de Operadora E2E").selectOption({ label: "Regla E2E" })
  await expect(page.getByLabel("Regla de comisión de Operadora E2E")).toHaveValue(/.+/)

  // --- Cobrar un turno con la operadora, vía RPC (el flujo de cobro en sí
  // ya tiene su propio E2E en caja.spec.ts) ---
  await ownerAnon!.rpc("open_cash_session", { p_branch_id: branchId, p_opening_amount: 0 })
  const { error: saleError } = await ownerAnon!.rpc("confirm_sale", {
    p_branch_id: branchId,
    p_client_id: null,
    p_appointment_id: null,
    p_items: [{ item_id: serviceId, item_type: "service", quantity: 1, operator_id: operatorId }],
    p_payments: [{ method: "cash", amount: 8000 }],
    p_discount: 0,
  })
  expect(saleError).toBeFalsy()

  // --- La dueña ve el devengado y liquida ---
  await page.reload()
  const settlementTable = page.getByRole("heading", { name: "Liquidación mensual" }).locator("xpath=following::table[1]")
  await expect(settlementTable.getByRole("cell", { name: "Operadora E2E" })).toBeVisible({ timeout: 15_000 })
  // 20% de 8000 = 1600.
  await expect(settlementTable.locator("tr", { hasText: "Operadora E2E" })).toContainText("1.600")

  page.once("dialog", (d) => d.accept())
  await page.getByRole("button", { name: /^Liquidar/ }).click()
  await expect(page.getByRole("button", { name: /^Liquidar/ })).toBeDisabled({ timeout: 15_000 })
})
