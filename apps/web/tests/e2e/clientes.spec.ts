import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Clientes: alta desde el listado, navegación a la ficha,
 * y edición de una nota técnica de historial. Mismo patrón que
 * agenda.spec.ts: tenant 100% descartable, provisionado a mano.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-clientes-owner-${Date.now()}@example.com`
const businessName = `E2E Clientes Salon ${Date.now()}`

let ownerId: string | undefined
let tenantId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
    const { data: clients } = await admin.from("clients").select("id").eq("tenant_id", tenantId)
    const clientIds = (clients ?? []).map((c) => c.id)
    if (clientIds.length > 0) {
      await admin.from("client_history").delete().in("client_id", clientIds)
    }
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
})

test("alta de cliente, ficha, y edición de nota técnica", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/clientes`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/clientes$/)
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible()

  // --- Alta desde el listado ---
  await page.getByRole("button", { name: "Nuevo cliente" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo cliente" })).toBeVisible()
  await page.getByLabel("Nombre").fill("Cliente E2E Clientes")
  await page.getByLabel("Teléfono").fill("+54 9 261 555-2222")
  await page.getByRole("button", { name: "Crear cliente" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo cliente" })).toBeHidden()
  await expect(page.getByRole("link", { name: "Cliente E2E Clientes" })).toBeVisible({ timeout: 10_000 })

  // --- Entrar a la ficha ---
  await page.getByRole("link", { name: "Cliente E2E Clientes" }).click()
  await page.waitForURL(/\/dashboard\/clientes\/[a-f0-9-]+$/)
  await expect(page.getByRole("heading", { name: "Cliente E2E Clientes" })).toBeVisible()

  const clientIdMatch = page.url().match(/\/clientes\/([a-f0-9-]+)$/)
  const clientId = clientIdMatch?.[1]
  if (!clientId) throw new Error("No pude extraer el clientId de la URL")

  // Simula una fila de historial ya existente (ej. generada por Agenda al
  // completar un turno) para poder editar su nota técnica.
  await admin.from("client_history").insert({ tenant_id: tenantId, client_id: clientId, technical_notes: null })
  await page.reload()

  // --- Un refresh que aterriza con el form abierto no pisa lo ya tipeado ---
  // Regresión de la carrera de estado del Sheet de edición. Cuando
  // ClientFormSheet sembraba su estado con `useEffect(..., [open, client])`,
  // el efecto no corría una sola vez: `client` es un objeto nuevo en cada
  // render del server component, así que *cualquier* árbol fresco que
  // llegara con el Sheet abierto — un revalidatePath, un router.refresh() —
  // volvía a disparar el efecto y pisaba en silencio lo que la persona
  // estaba tipeando.
  //
  // Reproducirlo por timing (tipear más rápido de lo que React corre el
  // efecto después del pintado) es una carrera que el test gana casi
  // siempre, así que no protege de nada. Lo determinístico es el orden entre
  // "tipeé" y "llegó el árbol nuevo", y ese orden lo podemos fijar:
  // interceptamos el POST del server action de la nota técnica y lo soltamos
  // recién después de escribir el teléfono. El árbol revalidado aterriza
  // entonces con el Sheet abierto y el campo ya cargado — exactamente la
  // situación que el bug rompía.
  let releaseNoteSave!: () => void
  const noteSaveGate = new Promise<void>((resolve) => {
    releaseNoteSave = resolve
  })
  let gated = false
  await page.route(`**/dashboard/clientes/${clientId}`, async (route) => {
    const request = route.request()
    // Los server actions de Next viajan como POST a la URL de la página con
    // el header `Next-Action`; el GET del documento no nos interesa.
    if (!gated && request.method() === "POST" && request.headers()["next-action"]) {
      gated = true
      await noteSaveGate
    }
    await route.continue()
  })

  await page.getByRole("button", { name: "Agregar nota" }).click()
  await page.locator("textarea").fill("Tono 7.3, sensibilidad en cutícula")
  await page.getByRole("button", { name: "Guardar" }).click()

  // El action quedó retenido: abrimos el Sheet y tipeamos con toda calma.
  await page.getByRole("button", { name: "Editar" }).click()
  await expect(page.getByRole("heading", { name: "Editar cliente" })).toBeVisible()
  await page.getByLabel("Teléfono").fill("+54 9 261 555-9999")

  // Recién ahora dejamos pasar el action, y esperamos a que el árbol fresco
  // se aplique con el Sheet todavía abierto. La señal tiene que ser un
  // elemento que sólo pueda existir si el dato vino del server: el botón de
  // la celda con el texto de la nota se renderiza desde
  // `entry.technical_notes`, así que aparece únicamente con historial
  // revalidado. (Un `getByText` del mismo texto no sirve: matchea el
  // textarea que este test acaba de llenar, y el test sigue de largo antes
  // de que el refresh aterrice — que es justo por qué la versión anterior de
  // esta regresión pasaba en verde contra el código roto.)
  releaseNoteSave()
  await expect(page.getByRole("button", { name: "Tono 7.3, sensibilidad en cutícula" })).toBeVisible({
    timeout: 15_000,
  })

  // El invariante: el re-render no tocó el input.
  await expect(page.getByLabel("Teléfono")).toHaveValue("+54 9 261 555-9999")

  await page.getByRole("button", { name: "Guardar cambios" }).click()
  await expect(page.getByRole("heading", { name: "Editar cliente" })).toBeHidden()
  await expect(page.getByText("+54 9 261 555-9999")).toBeVisible({ timeout: 10_000 })
})
