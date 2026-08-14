import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Inventario: alta de un insumo, compra, recuento, historial
 * de movimientos y alerta de mínimo. Mismo patrón que servicios.spec.ts:
 * tenant 100% descartable.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-inventario-owner-${Date.now()}@example.com`
const businessName = `E2E Inventario Salon ${Date.now()}`

let ownerId: string | undefined
let tenantId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
    // El orden importa: inventory y inventory_movements referencian
    // branches, así que van antes que la sucursal.
    const { data: branches } = await admin.from("branches").select("id").eq("tenant_id", tenantId)
    const branchIds = (branches ?? []).map((b) => b.id)
    if (branchIds.length > 0) {
      await admin.from("inventory").delete().in("branch_id", branchIds)
    }
    await admin.from("inventory_movements").delete().eq("tenant_id", tenantId)
    await admin.from("supplies").delete().eq("tenant_id", tenantId)
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
})

test("alta de insumo, compra, recuento, historial y alerta de mínimo", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/inventario`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/inventario$/)
  await expect(page.getByRole("heading", { name: "Inventario" })).toBeVisible()

  // --- Alta de insumo ---
  await page.getByRole("button", { name: "Nuevo insumo" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo insumo" })).toBeVisible()
  await page.getByLabel("Nombre").fill("Esmalte E2E")
  // exact: true — sin él, "Unidad" matchea por substring y también agarra
  // el campo "Costo por unidad".
  await page.getByLabel("Unidad", { exact: true }).selectOption("ml")
  await page.getByLabel("Costo por unidad").fill("800")
  await page.getByRole("button", { name: "Crear insumo" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo insumo" })).toBeHidden()

  // Aparece con stock 0 y SIN badge "Bajo": un mínimo en 0 significa
  // "no me avises", no "avisame siempre".
  const row = page.getByRole("row", { name: /Esmalte E2E/ })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row.getByText("Bajo")).toHaveCount(0)

  // --- Compra de 10 ---
  await row.getByRole("button", { name: "Ajustar" }).click()
  await expect(page.getByRole("heading", { name: /Ajustar stock/ })).toBeVisible()
  await page.getByLabel("Tipo de movimiento").selectOption("compra")
  await page.getByLabel("Cantidad que entró").fill("10")
  await page.getByRole("button", { name: "Registrar movimiento" }).click()
  await expect(page.getByRole("heading", { name: /Ajustar stock/ })).toBeHidden()
  await expect(page.getByRole("row", { name: /Esmalte E2E/ }).getByText("10")).toBeVisible({ timeout: 10_000 })

  // --- Recuento de 7 ---
  // El campo cambia de etiqueta al elegir "Recuento": pide el total contado,
  // no la diferencia. La resta la hace record_stock_count bajo su lock.
  await page.getByRole("row", { name: /Esmalte E2E/ }).getByRole("button", { name: "Ajustar" }).click()
  await page.getByLabel("Tipo de movimiento").selectOption("recuento")
  await page.getByLabel("Cuánto contaste").fill("7")
  await page.getByRole("button", { name: "Registrar movimiento" }).click()
  await expect(page.getByRole("heading", { name: /Ajustar stock/ })).toBeHidden()
  await expect(page.getByRole("row", { name: /Esmalte E2E/ }).getByText("7")).toBeVisible({ timeout: 10_000 })

  // --- El historial muestra los dos movimientos ---
  await page.getByRole("row", { name: /Esmalte E2E/ }).getByRole("button", { name: "Ajustar" }).click()
  await expect(page.getByRole("heading", { name: "Últimos movimientos" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "Compra" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "Recuento" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "+10", exact: true })).toBeVisible()
  await expect(page.getByRole("cell", { name: "-3", exact: true })).toBeVisible()

  // --- Alerta de mínimo ---
  // El mínimo se guarda en su propio form del mismo Sheet: no mueve stock,
  // así que no genera movimiento. Con el stock en 7 y el mínimo en 8, la
  // fila tiene que pasar a mostrar el badge "Bajo".
  await page.getByLabel("Avisarme cuando baje de").fill("8")
  await page.getByRole("button", { name: "Guardar mínimo" }).click()
  await expect(page.getByRole("row", { name: /Esmalte E2E/ }).getByText("Bajo")).toBeVisible({
    timeout: 10_000,
  })

  // Y el contador de arriba lo refleja.
  await page.getByRole("button", { name: "Cerrar" }).click()
  await expect(page.getByText("Ítems bajo el mínimo")).toBeVisible()
  await expect(page.locator(".stat-tile-value")).toHaveText("1")
})
