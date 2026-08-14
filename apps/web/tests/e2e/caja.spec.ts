import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Caja: abrir caja, venta de mostrador con pago mixto,
 * anulación, y cierre con arqueo. Tenant 100% descartable.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-caja-owner-${Date.now()}@example.com`
const businessName = `E2E Caja Salon ${Date.now()}`

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
    await admin.from("inventory_movements").delete().eq("tenant_id", tenantId)
    const { data: branches } = await admin.from("branches").select("id").eq("tenant_id", tenantId)
    const branchIds = (branches ?? []).map((b) => b.id)
    if (branchIds.length > 0) await admin.from("inventory").delete().in("branch_id", branchIds)
    await admin.from("retail_products").delete().eq("tenant_id", tenantId)
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

  const { data: product } = await ownerAnon
    .from("retail_products")
    .insert({ tenant_id: tenantId, name: "Shampoo E2E", sale_price: 5000, cost: 2000 })
    .select("id")
    .single()

  await ownerAnon.rpc("adjust_stock", {
    p_branch_id: branchId,
    p_item_id: product!.id,
    p_item_type: "product",
    p_delta: 10,
    p_reason: "compra",
    p_note: null,
  })
})

test("abrir caja, cobrar con pago mixto, anular y cerrar con arqueo", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/caja`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/caja$/)
  // exact: true — sin él, "Caja" matchea por substring y también agarra el
  // <h2>Abrir caja</h2>.
  await expect(page.getByRole("heading", { name: "Caja", exact: true })).toBeVisible()

  // --- Abrir caja con $1000 ---
  await page.getByLabel("Con cuánto arrancás").fill("1000")
  await page.getByRole("button", { name: "Abrir caja" }).click()
  await expect(page.getByRole("heading", { name: "Nueva venta" })).toBeVisible({ timeout: 15_000 })

  // --- Venta de mostrador con pago mixto: 3000 efectivo + 2000 tarjeta ---
  // El label de la opción lleva el precio formateado ("Shampoo E2E — $ 5.000,00"),
  // así que se busca la opción por texto y se selecciona por su value.
  const picker = page.getByLabel("Agregar ítem")
  const productValue = await picker.locator("option", { hasText: "Shampoo E2E" }).getAttribute("value")
  await picker.selectOption(productValue!)
  await expect(page.locator(".sale-total")).toContainText("5.000")

  await page.getByLabel("Monto del pago 1").fill("3000")
  await page.getByRole("button", { name: "Otro medio de pago" }).click()
  await page.getByLabel("Medio de pago 2").selectOption("card")
  await page.getByLabel("Monto del pago 2").fill("2000")
  await expect(page.getByText("Los pagos cierran.")).toBeVisible()

  await page.getByRole("button", { name: "Cobrar", exact: true }).click()
  await expect(page.getByRole("cell", { name: /Shampoo E2E ×1/ })).toBeVisible({ timeout: 15_000 })

  // --- Anular ---
  page.once("dialog", (d) => d.accept("cobrada por error"))
  await page.getByRole("button", { name: "Anular" }).click()
  await expect(page.getByText("Anulada")).toBeVisible({ timeout: 15_000 })

  // --- Cerrar caja ---
  // La venta se anuló, así que el esperado es sólo la apertura: 1000.
  // Contamos 1000 → diferencia 0.
  await page.getByLabel("Cuánto contaste").fill("1000")
  await page.getByRole("button", { name: "Cerrar caja" }).click()
  await expect(page.getByText("Último cierre — esperado")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("heading", { name: "Abrir caja" })).toBeVisible()
})
