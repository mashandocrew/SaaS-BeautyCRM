import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Reportes: una venta y un turno cancelado del mes actual
 * aparecen en el resumen, y el CSV se puede exportar.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-reportes-owner-${Date.now()}@example.com`
const businessName = `E2E Reportes Salon ${Date.now()}`

let ownerId: string | undefined
let tenantId: string | undefined
let branchId: string | undefined

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
    await admin.from("appointments").delete().eq("tenant_id", tenantId)
    await admin.from("services").delete().eq("tenant_id", tenantId)
    await admin.from("clients").delete().eq("tenant_id", tenantId)
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
  branchId = tenantRow[0].branch_id

  const { data: service } = await ownerAnon
    .from("services")
    .insert({ tenant_id: tenantId, name: "Corte Reportes E2E", price: 7000, duration_minutes: 30 })
    .select("id")
    .single()

  const { data: client } = await ownerAnon
    .from("clients")
    .insert({ tenant_id: tenantId, full_name: "Cliente Reportes E2E" })
    .select("id")
    .single()

  // --- Venta del mes actual ---
  await ownerAnon.rpc("open_cash_session", { p_branch_id: branchId, p_opening_amount: 0 })
  await ownerAnon.rpc("confirm_sale", {
    p_branch_id: branchId,
    p_client_id: client!.id,
    p_appointment_id: null,
    p_items: [{ item_id: service!.id, item_type: "service", quantity: 1, operator_id: null }],
    p_payments: [{ method: "cash", amount: 7000 }],
    p_discount: 0,
  })

  // --- Turno cancelado del mes actual ---
  const { data: booking } = await ownerAnon.rpc("book_appointment", {
    p_branch_id: branchId,
    p_client_id: client!.id,
    p_operator_id: ownerId,
    p_starts_at: new Date().toISOString(),
    p_service_ids: [service!.id],
  })
  await admin.from("appointments").update({ status: "cancelled" }).eq("id", booking![0].appointment_id)
})

test("ve el total del mes, el turno cancelado, y exporta el CSV", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/reportes`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/reportes$/)
  await expect(page.getByRole("heading", { name: "Reportes", exact: true })).toBeVisible()

  await expect(page.getByText("Total vendido")).toBeVisible()
  // Con una sola venta de $7000, el total y el ticket promedio coinciden —
  // ambos textos aparecen en la página, por eso .first().
  await expect(page.getByText("$ 7.000,00").first()).toBeVisible({ timeout: 15_000 })

  await expect(page.getByRole("heading", { name: "Top servicios" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "Corte Reportes E2E" })).toBeVisible()

  await expect(page.getByRole("heading", { name: "Turnos por estado" })).toBeVisible()
  await expect(page.getByText("Cancelados")).toBeVisible()
  await expect(page.locator("tr", { hasText: "Cancelados" })).toContainText("1")

  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Exportar CSV" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^ventas_.*\.csv$/)
})
