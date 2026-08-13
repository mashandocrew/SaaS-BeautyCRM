import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Servicios: alta con categoría, agrupado en el listado,
 * edición, desactivación, y la consecuencia que le importa al negocio —
 * que un servicio desactivado deja de ofrecerse en el modal de nuevo turno
 * de Agenda. Mismo patrón que clientes.spec.ts: tenant 100% descartable.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-servicios-owner-${Date.now()}@example.com`
const businessName = `E2E Servicios Salon ${Date.now()}`

let ownerId: string | undefined
let operatorId: string | undefined
let tenantId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
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

  // AgendaGrid no dibuja ninguna celda ".agenda-grid-slot" si la sucursal
  // no tiene operadoras (ver AgendaGrid.tsx: `if (operators.length === 0)
  // return <p>...</p>`) — sin esto, el paso final de este test (verificar
  // que un servicio desactivado ya no aparece en el modal de nuevo turno)
  // no tiene ninguna celda para hacer click. Mismo patrón que
  // agenda.spec.ts.
  const { data: operatorData, error: operatorError } = await admin.auth.admin.createUser({
    email: `e2e-servicios-operator-${Date.now()}@example.com`,
    email_confirm: true,
  })
  if (operatorError || !operatorData.user) throw new Error(`No pude crear la operadora: ${operatorError?.message}`)
  operatorId = operatorData.user.id
  await admin.from("users").update({ full_name: "Operadora E2E Servicios" }).eq("id", operatorId)

  const { error: membershipError } = await admin.from("memberships").insert({
    tenant_id: tenantId,
    user_id: operatorId,
    branch_id: branchId,
    role: "operator",
  })
  if (membershipError) throw new Error(`No pude crear la membership de la operadora: ${membershipError.message}`)
})

test("alta, agrupado por categoría, edición y desactivación de un servicio", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/servicios`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/servicios$/)
  await expect(page.getByRole("heading", { name: "Servicios" })).toBeVisible()

  // --- Alta con categoría ---
  await page.getByRole("button", { name: "Nuevo servicio" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo servicio" })).toBeVisible()
  await page.getByLabel("Nombre").fill("Corte E2E")
  await page.getByLabel("Duración (minutos)").fill("45")
  await page.getByLabel("Precio").fill("12000")
  await page.getByLabel("Categoría").fill("Cabello E2E")
  await page.getByRole("button", { name: "Crear servicio" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo servicio" })).toBeHidden()

  // Aparece agrupado bajo su categoría, con precio y duración formateados.
  await expect(page.getByRole("heading", { name: "Cabello E2E" })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole("button", { name: "Corte E2E" })).toBeVisible()
  await expect(page.getByText("45 min")).toBeVisible()

  // --- Edición ---
  await page.getByRole("button", { name: "Corte E2E" }).click()
  await expect(page.getByRole("heading", { name: "Editar servicio" })).toBeVisible()
  await page.getByLabel("Duración (minutos)").fill("60")
  await page.getByRole("button", { name: "Guardar cambios" }).click()
  await expect(page.getByRole("heading", { name: "Editar servicio" })).toBeHidden()
  await expect(page.getByText("60 min")).toBeVisible({ timeout: 10_000 })

  // --- Desactivación desde el toggle de la fila ---
  // Click + assertion con retry en vez de .uncheck() (que verifica el
  // estado con un solo chequeo inmediato después del click): el toggle es
  // un checkbox controlado por `is_active` desde el server, así que no
  // cambia visualmente hasta que la server action responde y
  // router.refresh() re-renderiza con el dato fresco — una operación
  // async, no instantánea.
  await page.getByRole("switch", { name: "Servicio activo: Corte E2E" }).click()
  await expect(page.getByRole("switch", { name: "Servicio activo: Corte E2E" })).not.toBeChecked({ timeout: 10_000 })
  await expect(page.getByText("Inactivo")).toBeVisible({ timeout: 10_000 })

  // --- La consecuencia real: ya no se ofrece al crear un turno ---
  await page.goto(`${baseURL}/dashboard/agenda`)
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible()
  // El modal de nuevo turno se abre desde una celda de la grilla (ver
  // agenda.spec.ts:107-109), no desde un botón "Nuevo turno" — no existe tal
  // botón en /dashboard/agenda.
  await page.locator(".agenda-grid-slot").first().click()
  await expect(page.getByRole("heading", { name: "Nuevo turno" })).toBeVisible()
  await expect(page.getByRole("checkbox", { name: /Corte E2E/ })).toHaveCount(0)
})
