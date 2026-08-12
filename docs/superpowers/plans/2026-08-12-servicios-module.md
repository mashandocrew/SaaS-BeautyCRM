# Módulo Servicios — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el frontend del módulo Servicios de BeautyCRM en `/dashboard/servicios`: catálogo agrupado por categoría, alta/edición en Sheet, activar/desactivar por fila, y borrado real restringido a Dueño — con la capa de datos (tipos, query, server actions) que lo soporta.

**Architecture:** Next.js 14 App Router + Supabase (RLS), mismo patrón que Agenda y Clientes ya en producción: Server Component para la lectura inicial, Client Components para interacción (agrupado en memoria, Sheet de alta/edición, toggle por fila), Server Actions para las mutaciones. **Sin migración nueva** — la tabla `services` y sus policies existen desde `migrations/0001_initial_schema.sql`. Sin ruta de detalle, sin búsqueda, sin realtime.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript strict, Supabase (`@supabase/ssr`), `@beautycrm/ui`, `@phosphor-icons/react`, Playwright, tsx.

## Global Constraints

- Repo: `SaaS-BeautyCRM` (monorepo pnpm: `apps/web`, `packages/ui`, `packages/supabase`).
- Proyecto Supabase: `xhbrhpfzehshiyjzlxnx` (región `sa-east-1`).
- Tenants de prueba: descartables, provisionados vía `provision_tenant` con admin API — nunca el tenant real `fab8b076-ed53-41c3-bfd6-c581af97fe56`.
- No agregar dependencias nuevas.
- **No hay migración en este módulo.** `services` ya existe en `migrations/0001_initial_schema.sql` y ya está en `packages/supabase/src/types.ts` (líneas 787-814). **No correr `pnpm types:generate`** — no hay nada nuevo que generar y regenerar introduce ruido de diff.
- Toda copy de UI en español, tono como el resto de la app (ver `docs/ui-design-system.md`).
- Server Actions devuelven `{ ok: true, data } | { ok: false, error, code? }` — mismo patrón `ActionResult<T>` que `lib/agenda-actions.ts` y `lib/client-actions.ts`. **Cada módulo declara su propio `ActionResult`** (no se importa el de otro módulo) — es la convención ya establecida en los dos archivos citados.
- RLS es la barrera de verdad. La validación client-side es feedback inmediato, nunca la única barrera.
- **No tocar** `apps/web/lib/agenda-queries.ts` (incluido `getActiveServices`), `lib/agenda-actions.ts`, `lib/client-*.ts`, ni `app/o/**` — son flujos en producción, fuera de alcance.
- Design tokens: usar las variables CSS ya definidas en `apps/web/app/globals.css`. No hardcodear valores.
- Spec completa: `docs/superpowers/specs/2026-08-12-servicios-module-design.md`.

## Decisiones tomadas después de la spec

La spec listaba `deleteService` entre las acciones pero no le daba lugar en la UI (Servicios no tiene ruta de detalle, que es donde vive "Eliminar" en Clientes). Resuelto con el usuario el 2026-08-12:

1. **El botón "Eliminar servicio" vive en el footer del `ServiceFormSheet` en modo `edit`**, separado de "Guardar cambios" por un divisor. No hay acción de borrado en las filas de la tabla.
2. **El botón solo se renderiza para `role === "owner"`.** `services_delete` es owner-only (`migrations/0001_initial_schema.sql:413-414`); mostrarle a un supervisor una acción que RLS siempre va a rechazar es una promesa falsa. Esto obliga a pasar `membership.role` desde `page.tsx` → `ServicesList` → `ServiceFormSheet`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `apps/web/lib/service-types.ts` | `ServiceRecord` (alias de `Tables<"services">`) y `ServiceInput` (forma camelCase que consume el form). Sin lógica. |
| `apps/web/lib/service-queries.ts` | Lectura server-only: `getServices(tenantId)`. |
| `apps/web/lib/service-actions.ts` | Las 4 mutaciones + validación compartida + mapeo de errores de Postgres a copy en español. |
| `apps/web/app/dashboard/servicios/page.tsx` | Server Component: sesión → `getServices` → `ServicesList`. |
| `apps/web/app/dashboard/servicios/ServicesList.tsx` | Agrupado por categoría en memoria, una tabla por grupo, toggle por fila, apertura del Sheet en ambos modos. |
| `apps/web/app/dashboard/servicios/ServiceFormSheet.tsx` | Form alta/edición + borrado (owner). Única pieza que llama a `createService`/`updateService`/`deleteService`. |
| `apps/web/app/globals.css` | Única adición: la clase `.link-button` (nombre de servicio clickeable que abre un panel en vez de navegar). |
| `apps/web/tests/security/servicios-behavior.test.ts` | Invariantes de RLS y de FK a nivel datos. |
| `apps/web/tests/e2e/servicios.spec.ts` | Recorrido completo en el browser, incluido el cruce a Agenda. |

---

## Task 1: Test de invariantes de RLS y FK

Este test se escribe **primero** porque toda la UI del módulo depende de supuestos sobre RLS que todavía no verificamos en la práctica: que un supervisor puede crear pero no borrar, y que borrar un servicio usado falla con `23503`. Si alguno de esos supuestos es falso, la copy de la UI y la decisión de ocultar el botón de borrado están mal, y conviene saberlo antes de escribir el frontend, no después.

**Files:**
- Create: `apps/web/tests/security/servicios-behavior.test.ts`
- Modify: `apps/web/package.json` (agregar script `test:servicios`)
- Modify: `package.json` raíz (agregar script `test:servicios`)

**Interfaces:**
- Consumes: nada de tasks anteriores (es la primera).
- Produces: confirmación ejecutable de que `services_insert`/`services_update` son owner+supervisor, `services_delete` es owner-only, y que borrar un servicio referenciado desde `appointment_services` devuelve `error.code === "23503"`. Task 2 depende de ese código de error para su mapeo de copy.

- [ ] **Step 1: Escribir el test**

Crear `apps/web/tests/security/servicios-behavior.test.ts`:

```ts
/**
 * Invariantes del módulo Servicios a nivel de datos: quién puede crear,
 * editar y borrar un servicio, y qué pasa al borrar uno que ya se usó en
 * un turno. Mismo patrón que tests/security/clientes-behavior.test.ts:
 * datos 100% descartables contra el proyecto real, borrados en el finally.
 *
 * OJO: services_delete es owner-only (migrations/0001_initial_schema.sql),
 * más estricto que clients_delete (owner o supervisor). El Test 4 fija esa
 * asimetría a propósito — si algún día se relaja la policy, este test
 * falla y obliga a revisar también el frontend, que hoy le esconde el
 * botón "Eliminar servicio" al supervisor.
 *
 * Ejecutar: pnpm test:servicios (desde apps/web, con .env.local cargado)
 */
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Faltan env vars. Corré con apps/web/.env.local cargado.")
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function createTestUser(label: string) {
  const email = `servicios-test-${label}-${Date.now()}@example.com`
  const password = `Test-${Math.random().toString(36).slice(2)}!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`No pude crear usuario ${label}: ${error?.message}`)
  return { id: data.user.id, email, password }
}

async function signIn(email: string, password: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`No pude loguear ${email}: ${error.message}`)
  return client
}

async function main() {
  const userIds: string[] = []
  let tenantId: string | undefined
  let branchId: string | undefined
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Servicios Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    branchId = tenantRow[0].branch_id

    console.log("Creando operadora y supervisora...")
    const operatorUser = await createTestUser("operator")
    userIds.push(operatorUser.id)
    const operatorClient = await signIn(operatorUser.email, operatorUser.password)

    const supervisorUser = await createTestUser("supervisor")
    userIds.push(supervisorUser.id)
    const supervisorClient = await signIn(supervisorUser.email, supervisorUser.password)

    const { error: membershipError } = await admin.from("memberships").insert([
      { tenant_id: tenantId, user_id: operatorUser.id, branch_id: null, role: "operator" },
      { tenant_id: tenantId, user_id: supervisorUser.id, branch_id: null, role: "supervisor" },
    ])
    if (membershipError) throw new Error(`No pude crear memberships: ${membershipError.message}`)

    const { data: baseService, error: baseServiceError } = await ownerClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Corte base", duration_minutes: 45, price: 12000, category: "Cabello" })
      .select()
      .single()
    if (baseServiceError || !baseService) throw new Error(`No pude crear servicio base: ${baseServiceError?.message}`)

    // --- Test 1: operador no puede crear un servicio ---
    console.log("Test 1: operador no puede crear un servicio...")
    const { data: operatorInsert, error: operatorInsertError } = await operatorClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Servicio de operadora", duration_minutes: 30, price: 5000 })
      .select("id")
    if (!operatorInsertError && operatorInsert && operatorInsert.length > 0) {
      console.error("  FALLO — el operador pudo crear un servicio")
      failures++
    } else {
      console.log("  OK — RLS bloqueó el insert")
    }

    // --- Test 2: operador no puede editar un servicio ---
    console.log("Test 2: operador no puede editar un servicio...")
    const { data: operatorUpdate } = await operatorClient
      .from("services")
      .update({ price: 1 })
      .eq("id", baseService.id)
      .select("id")
    if (operatorUpdate && operatorUpdate.length > 0) {
      console.error("  FALLO — el operador pudo editar un servicio")
      failures++
    } else {
      console.log("  OK — 0 filas afectadas (RLS bloqueó)")
    }

    // --- Test 3: supervisor sí puede crear y editar ---
    console.log("Test 3: supervisor puede crear y editar servicios...")
    const { data: supervisorService, error: supervisorInsertError } = await supervisorClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Servicio de supervisora", duration_minutes: 60, price: 15000 })
      .select()
      .single()
    if (supervisorInsertError || !supervisorService) {
      console.error("  FALLO — la supervisora no pudo crear un servicio:", supervisorInsertError?.message)
      failures++
    } else {
      const { data: supervisorUpdate, error: supervisorUpdateError } = await supervisorClient
        .from("services")
        .update({ price: 16000 })
        .eq("id", supervisorService.id)
        .select("price")
        .maybeSingle()
      if (supervisorUpdateError || Number(supervisorUpdate?.price) !== 16000) {
        console.error("  FALLO — la supervisora no pudo editar el servicio:", supervisorUpdateError?.message)
        failures++
      } else {
        console.log("  OK — creó y editó")
      }
    }

    // --- Test 4: supervisor NO puede borrar (services_delete es owner-only) ---
    console.log("Test 4: supervisor no puede borrar un servicio...")
    const { data: throwaway, error: throwawayError } = await ownerClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Servicio descartable", duration_minutes: 15, price: 1000 })
      .select()
      .single()
    if (throwawayError || !throwaway) throw new Error(`No pude crear servicio descartable: ${throwawayError?.message}`)

    const { data: supervisorDelete } = await supervisorClient
      .from("services")
      .delete()
      .eq("id", throwaway.id)
      .select("id")
    const { data: stillThere } = await admin.from("services").select("id").eq("id", throwaway.id).maybeSingle()
    if ((supervisorDelete && supervisorDelete.length > 0) || !stillThere) {
      console.error("  FALLO — la supervisora pudo borrar un servicio (services_delete debería ser owner-only)")
      failures++
    } else {
      console.log("  OK — 0 filas afectadas (RLS bloqueó), el servicio sigue existiendo")
    }

    // --- Test 5: owner sí puede borrar un servicio sin uso ---
    console.log("Test 5: el dueño puede borrar un servicio sin uso...")
    const { data: ownerDelete, error: ownerDeleteError } = await ownerClient
      .from("services")
      .delete()
      .eq("id", throwaway.id)
      .select("id")
      .maybeSingle()
    if (ownerDeleteError || !ownerDelete) {
      console.error("  FALLO — el dueño no pudo borrar un servicio sin uso:", ownerDeleteError?.message)
      failures++
    } else {
      console.log("  OK — borrado")
    }

    // --- Test 6: borrar un servicio usado en un turno falla por FK ---
    console.log("Test 6: borrar un servicio ya usado en un turno falla por FK (a propósito)...")
    const { data: client, error: clientError } = await ownerClient
      .from("clients")
      .insert({ tenant_id: tenantId, full_name: "Cliente de prueba servicios" })
      .select()
      .single()
    if (clientError || !client) throw new Error(`No pude crear cliente: ${clientError?.message}`)

    const startsAt = new Date(Date.now() + 3600_000).toISOString()
    const endsAt = new Date(Date.now() + 3600_000 + 45 * 60_000).toISOString()
    const { data: appointment, error: appointmentError } = await admin
      .from("appointments")
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        client_id: client.id,
        operator_id: operatorUser.id,
        starts_at: startsAt,
        ends_at: endsAt,
      })
      .select()
      .single()
    if (appointmentError || !appointment) throw new Error(`No pude crear turno: ${appointmentError?.message}`)

    const { error: linkError } = await admin
      .from("appointment_services")
      .insert({ appointment_id: appointment.id, service_id: baseService.id, price_snapshot: 12000 })
    if (linkError) throw new Error(`No pude vincular servicio al turno: ${linkError.message}`)

    const { error: usedDeleteError } = await ownerClient.from("services").delete().eq("id", baseService.id)
    if (!usedDeleteError) {
      console.error("  FALLO — se borró un servicio con appointment_services asociado, sin error de FK")
      failures++
    } else if (usedDeleteError.code !== "23503") {
      console.error("  FALLO — falló pero con un código inesperado:", usedDeleteError.code, usedDeleteError.message)
      failures++
    } else {
      console.log("  OK — bloqueado por foreign_key_violation (23503)")
    }
  } finally {
    console.log("Limpiando datos de prueba...")
    if (tenantId) {
      // Borramos por tenant_id (no solo por los ids que veníamos trackeando)
      // para no dejar basura si algún assert tira antes de registrar un id —
      // mismo patrón defensivo que clientes-behavior.test.ts. El orden
      // respeta las FK: primero lo que referencia, después lo referenciado.
      const { data: appointments } = await admin.from("appointments").select("id").eq("tenant_id", tenantId)
      const appointmentIds = (appointments ?? []).map((a) => a.id)
      if (appointmentIds.length > 0) {
        await admin.from("appointment_services").delete().in("appointment_id", appointmentIds)
      }
      await admin.from("client_history").delete().eq("tenant_id", tenantId)
      await admin.from("appointments").delete().eq("tenant_id", tenantId)
      await admin.from("services").delete().eq("tenant_id", tenantId)
      await admin.from("clients").delete().eq("tenant_id", tenantId)
      await admin.from("memberships").delete().eq("tenant_id", tenantId)
      await admin.from("branches").delete().eq("tenant_id", tenantId)
      await admin.from("commission_rules").delete().eq("tenant_id", tenantId)
      await admin.from("tenants").delete().eq("id", tenantId)
    }
    for (const id of userIds) {
      await admin.from("users").delete().eq("id", id)
      await admin.auth.admin.deleteUser(id)
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) del módulo Servicios FALLARON.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Servicios pasaron.")
}

main().catch((err) => {
  console.error("Error inesperado en el test de Servicios:", err)
  process.exit(1)
})
```

- [ ] **Step 2: Agregar el script a `apps/web/package.json`**

En el bloque `"scripts"`, después de `"test:clientes"`:

```json
    "test:servicios": "tsx --env-file=.env.local tests/security/servicios-behavior.test.ts"
```

- [ ] **Step 3: Agregar el script al `package.json` raíz**

En el bloque `"scripts"`, después de `"test:clientes"`:

```json
    "test:servicios": "pnpm --filter @beautycrm/web test:servicios",
```

- [ ] **Step 4: Correr el test**

Run: `pnpm test:servicios` (desde la raíz del repo)

Expected: **PASS — los 6 tests en verde.** Este test caracteriza policies que ya existen en producción, así que no hay una fase roja: pasa desde el primer intento.

**Si algún test falla, PARÁ y reportá — no arregles el test para que pase.** Un fallo acá significa que el schema en vivo no coincide con lo que asume la spec, y las Tasks 2-4 están construidas sobre ese supuesto. En particular:
- Si el Test 4 falla (la supervisora **sí** pudo borrar), la decisión de ocultarle el botón está mal fundada y hay que revisarla con el usuario antes de seguir.
- Si el Test 6 falla con un código distinto de `23503`, el mapeo de error de la Task 2 tiene que cambiar.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/security/servicios-behavior.test.ts apps/web/package.json package.json
git commit -m "test(web): invariantes de RLS y FK del módulo Servicios"
```

---

## Task 2: Capa de datos — tipos, query y server actions

**Files:**
- Create: `apps/web/lib/service-types.ts`
- Create: `apps/web/lib/service-queries.ts`
- Create: `apps/web/lib/service-actions.ts`

**Interfaces:**
- Consumes: de Task 1, la confirmación de que el error de FK al borrar es `"23503"`.
- Produces, para la Task 3:
  - `type ServiceRecord = Tables<"services">` — campos: `id`, `tenant_id`, `name`, `duration_minutes`, `price`, `category` (`string | null`), `is_active`.
  - `type ServiceInput = { name: string; durationMinutes: number; price: number; category: string | null; isActive: boolean }`
  - `getServices(tenantId: string): Promise<ServiceRecord[]>`
  - `createService(tenantId: string, input: ServiceInput): Promise<ActionResult<ServiceRecord>>`
  - `updateService(serviceId: string, input: ServiceInput): Promise<ActionResult<ServiceRecord>>`
  - `toggleServiceActive(serviceId: string, isActive: boolean): Promise<ActionResult>`
  - `deleteService(serviceId: string): Promise<ActionResult>`

- [ ] **Step 1: Escribir `apps/web/lib/service-types.ts`**

```ts
import type { Tables } from "@beautycrm/supabase/types"

export type ServiceRecord = Tables<"services">

/**
 * Forma que consume el form. camelCase y sin `tenant_id` a propósito:
 * el tenant lo pone la server action desde la sesión, nunca el cliente —
 * mismo criterio que ClientInput en lib/client-types.ts / client-actions.ts.
 */
export type ServiceInput = {
  name: string
  durationMinutes: number
  price: number
  category: string | null
  isActive: boolean
}
```

- [ ] **Step 2: Escribir `apps/web/lib/service-queries.ts`**

```ts
import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { ServiceRecord } from "./service-types"

/**
 * Todos los servicios del tenant, activos e inactivos — a diferencia de
 * getActiveServices (lib/agenda-queries.ts), que filtra is_active para el
 * modal de nuevo turno. Acá el dueño necesita ver también los desactivados
 * para poder reactivarlos.
 *
 * nullsFirst: false manda los servicios sin categoría al final, que es
 * donde ServicesList renderiza el grupo "Sin categoría".
 */
export async function getServices(tenantId: string): Promise<ServiceRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("services")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("category", { nullsFirst: false })
    .order("name")

  // price es `numeric` en Postgres y supabase-js lo puede devolver como
  // string aunque types.ts lo tipe `number` — mismo Number() defensivo que
  // ya hace getActiveServices en lib/agenda-queries.ts.
  return (data ?? []).map((s) => ({ ...s, price: Number(s.price) }))
}
```

- [ ] **Step 3: Escribir `apps/web/lib/service-actions.ts`**

```ts
"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { ServiceInput, ServiceRecord } from "./service-types"

// Declarado local en vez de importado de client-actions.ts: cada módulo
// declara el suyo (agenda-actions.ts y client-actions.ts hacen lo mismo),
// así ningún módulo depende del archivo de otro.
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

// No exportada: en un archivo "use server" todo lo exportado tiene que ser
// una función async (los `type` se borran en compilación y no cuentan).
function validateInput(input: ServiceInput): string | null {
  if (!input.name.trim()) return "El nombre es obligatorio."
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
    return "La duración tiene que ser mayor a 0 minutos."
  }
  if (!Number.isFinite(input.price) || input.price < 0) return "El precio no puede ser negativo."
  return null
}

export async function createService(tenantId: string, input: ServiceInput): Promise<ActionResult<ServiceRecord>> {
  const invalid = validateInput(input)
  if (invalid) return { ok: false, error: invalid }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase
    .from("services")
    .insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      duration_minutes: input.durationMinutes,
      price: input.price,
      category: input.category,
      is_active: input.isActive,
    })
    .select("*")
    .single()

  if (error || !data) return { ok: false, error: "No pudimos crear el servicio." }

  revalidatePath("/dashboard/servicios")
  // Agenda lee el catálogo para el modal de nuevo turno (getActiveServices):
  // un servicio nuevo tiene que aparecer ahí sin esperar a que expire el
  // cache de la ruta.
  revalidatePath("/dashboard/agenda")
  return { ok: true, data }
}

export async function updateService(serviceId: string, input: ServiceInput): Promise<ActionResult<ServiceRecord>> {
  const invalid = validateInput(input)
  if (invalid) return { ok: false, error: invalid }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  // .select().maybeSingle() en vez de solo mirar `error`: si RLS bloquea el
  // UPDATE (fila de otro tenant, o rol sin permiso), Postgres no tira error,
  // simplemente actualiza 0 filas — mismo patrón que updateClient.
  const { data, error } = await supabase
    .from("services")
    .update({
      name: input.name.trim(),
      duration_minutes: input.durationMinutes,
      price: input.price,
      category: input.category,
      is_active: input.isActive,
    })
    .eq("id", serviceId)
    .select("*")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos actualizar el servicio." }

  revalidatePath("/dashboard/servicios")
  revalidatePath("/dashboard/agenda")
  return { ok: true, data }
}

/**
 * Toca solamente is_active. Es la acción cotidiana para sacar un servicio
 * de circulación: el historial que ya lo referencia queda intacto y deja de
 * aparecer en el modal de nuevo turno. Sin confirmación — se deshace con un
 * clic.
 */
export async function toggleServiceActive(serviceId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase
    .from("services")
    .update({ is_active: isActive })
    .eq("id", serviceId)
    .select("id")
    .maybeSingle()

  if (error || !data) {
    return { ok: false, error: "No pudimos cambiar el estado del servicio. Puede que no tengas permiso." }
  }

  revalidatePath("/dashboard/servicios")
  revalidatePath("/dashboard/agenda")
  return { ok: true, data: undefined }
}

export async function deleteService(serviceId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase.from("services").delete().eq("id", serviceId).select("id").maybeSingle()

  if (error) {
    // 23503 = foreign_key_violation. appointment_services_service_id_fkey y
    // client_history_service_id_fkey son NO ACTION (verificado contra la base
    // real en la spec): un servicio con historial de uso no se borra
    // silenciosamente. Para eso está desactivarlo.
    if (error.code === "23503") {
      return {
        ok: false,
        error: "No se puede eliminar: este servicio ya fue usado en turnos. Desactivalo en vez de borrarlo.",
        code: error.code,
      }
    }
    return { ok: false, error: "No pudimos eliminar el servicio." }
  }
  if (!data) return { ok: false, error: "No pudimos eliminar el servicio. Puede que no tengas permiso." }

  revalidatePath("/dashboard/servicios")
  revalidatePath("/dashboard/agenda")
  return { ok: true, data: undefined }
}
```

- [ ] **Step 4: Verificar que compila**

Run: `pnpm --filter @beautycrm/web exec tsc --noEmit`

Expected: sin errores. Si `tsc --noEmit` choca con la config de Next, usar `pnpm build` como alternativa — también typechequea, solo que más lento.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/service-types.ts apps/web/lib/service-queries.ts apps/web/lib/service-actions.ts
git commit -m "feat(web): capa de datos del módulo Servicios — tipos, query y acciones"
```

---

## Task 3: UI — listado agrupado, Sheet de alta/edición, y activación del módulo

**Files:**
- Create: `apps/web/app/dashboard/servicios/ServiceFormSheet.tsx`
- Create: `apps/web/app/dashboard/servicios/ServicesList.tsx`
- Modify: `apps/web/app/globals.css` (agregar `.link-button` al final del bloque `/* Table */`, que hoy termina en la línea 683)
- Modify: `apps/web/app/dashboard/servicios/page.tsx` (reemplaza el `ComingSoon` actual, 5 líneas)
- Modify: `apps/web/components/Sidebar.tsx:30` (`implemented: false` → `true`)

**Interfaces:**
- Consumes de Task 2: `ServiceRecord`, `ServiceInput`, `getServices`, `createService`, `updateService`, `toggleServiceActive`, `deleteService` (firmas exactas en el bloque Interfaces de esa task).
- Produces para Task 4, los selectores que el E2E va a usar:
  - Heading `"Servicios"` (h1 de la página).
  - Botón `"Nuevo servicio"`.
  - Headings de Sheet: `"Nuevo servicio"` (create) y `"Editar servicio"` (edit).
  - Labels de campos: `"Nombre"`, `"Duración (minutos)"`, `"Precio"`, `"Categoría"`, `"Activo"`.
  - Botones de submit: `"Crear servicio"` / `"Guardar cambios"`, y `"Eliminar servicio"`.
  - Toggle por fila: `role="switch"` con nombre accesible `` `Servicio activo: ${name}` ``.
  - Nombre del servicio en la tabla: `role="button"` (abre el Sheet en modo edición).

- [ ] **Step 1: Escribir `apps/web/app/dashboard/servicios/ServiceFormSheet.tsx`**

```tsx
"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Trash } from "@phosphor-icons/react"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { createService, deleteService, updateService } from "@/lib/service-actions"
import type { ServiceInput, ServiceRecord } from "@/lib/service-types"

export function ServiceFormSheet({
  open,
  onClose,
  tenantId,
  mode,
  service,
  canDelete = false,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  mode: "create" | "edit"
  service?: ServiceRecord | null
  /** Solo el dueño puede borrar: services_delete es owner-only. */
  canDelete?: boolean
}) {
  const router = useRouter()
  // Duración y precio viven como string, no como number: si fueran number,
  // borrar el contenido del input daría NaN y el campo se volvería
  // imposible de vaciar mientras se tipea. Se parsean recién en el submit.
  const [name, setName] = useState("")
  const [durationMinutes, setDurationMinutes] = useState("60")
  const [price, setPrice] = useState("0")
  const [category, setCategory] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(service?.name ?? "")
    setDurationMinutes(String(service?.duration_minutes ?? 60))
    setPrice(String(service?.price ?? 0))
    setCategory(service?.category ?? "")
    setIsActive(service?.is_active ?? true)
    setError(null)
  }, [open, service])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const parsedDuration = Number(durationMinutes)
    const parsedPrice = Number(price)

    if (!name.trim()) {
      setError("El nombre es obligatorio.")
      return
    }
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      setError("La duración tiene que ser mayor a 0 minutos.")
      return
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError("El precio no puede ser negativo.")
      return
    }

    const input: ServiceInput = {
      name,
      durationMinutes: parsedDuration,
      price: parsedPrice,
      category: category.trim() || null,
      isActive,
    }

    setLoading(true)
    const result = mode === "create" ? await createService(tenantId, input) : await updateService(service!.id, input)
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  async function handleDelete() {
    if (!service) return
    if (!window.confirm(`¿Eliminar "${service.name}"? Esta acción no se puede deshacer.`)) return

    setError(null)
    setDeleting(true)
    const result = await deleteService(service.id)
    setDeleting(false)

    if (!result.ok) {
      // Se muestra en el banner del Sheet y NO se cierra, a diferencia del
      // window.alert de ClientDetailView: el error más probable acá es el de
      // FK ("ya fue usado en turnos"), cuya salida natural es destildar
      // "Activo" y guardar — es decir, quedarse en este mismo formulario.
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === "create" ? "Nuevo servicio" : "Editar servicio"} side="right">
      <form onSubmit={handleSubmit}>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Nombre" htmlFor="service-name">
          <Input id="service-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Duración (minutos)" htmlFor="service-duration">
          <Input
            id="service-duration"
            type="number"
            min={1}
            step={5}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            required
          />
        </Field>

        <Field label="Precio" htmlFor="service-price">
          <Input
            id="service-price"
            type="number"
            min={0}
            step={100}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </Field>

        <Field label="Categoría" htmlFor="service-category" hint="Opcional. Texto libre — por ejemplo: Cabello, Uñas.">
          <Input id="service-category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>

        <Field label="Activo" htmlFor="service-active">
          <input
            id="service-active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : mode === "create" ? "Crear servicio" : "Guardar cambios"}
        </Button>

        {mode === "edit" && canDelete ? (
          <>
            <hr style={{ margin: "var(--space-6) 0", border: 0, borderTop: "1px solid var(--color-border)" }} />
            <Button type="button" variant="danger" onClick={handleDelete} disabled={deleting}>
              <Trash size={16} weight="bold" /> {deleting ? "Eliminando..." : "Eliminar servicio"}
            </Button>
          </>
        ) : null}
      </form>
    </Sheet>
  )
}
```

- [ ] **Step 2: Escribir `apps/web/app/dashboard/servicios/ServicesList.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Scissors } from "@phosphor-icons/react"
import { Badge, Button, Card, EmptyState } from "@beautycrm/ui"
import { toggleServiceActive } from "@/lib/service-actions"
import type { ServiceRecord } from "@/lib/service-types"
import { ServiceFormSheet } from "./ServiceFormSheet"

const SIN_CATEGORIA = "Sin categoría"

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function ServicesList({
  tenantId,
  services,
  role,
}: {
  tenantId: string
  services: ServiceRecord[]
  role: string
}) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceRecord | null>(null)
  // id del servicio cuyo toggle está en vuelo, para deshabilitarlo y evitar
  // dobles clics mientras la server action responde.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canDelete = role === "owner"

  // getServices ya devuelve ordenado por category y luego name, así que
  // recorrer en orden y agrupar en un Map alcanza: las claves quedan en el
  // orden en que aparecen, y los null (que la query manda al final) caen
  // todos juntos en "Sin categoría".
  const groups = useMemo(() => {
    const map = new Map<string, ServiceRecord[]>()
    for (const service of services) {
      const key = service.category?.trim() || SIN_CATEGORIA
      const bucket = map.get(key)
      if (bucket) bucket.push(service)
      else map.set(key, [service])
    }
    return Array.from(map.entries())
  }, [services])

  async function handleToggle(service: ServiceRecord, nextActive: boolean) {
    setError(null)
    setPendingId(service.id)
    const result = await toggleServiceActive(service.id, nextActive)
    setPendingId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          marginBottom: "var(--space-4)",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} weight="bold" /> Nuevo servicio
        </Button>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {services.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Scissors size={24} weight="regular" />}
            title="Todavía no hay servicios"
            description="Cargá tu catálogo para poder elegir servicios al crear un turno en Agenda."
            action={<Button onClick={() => setCreateOpen(true)}>Agregar el primer servicio</Button>}
          />
        </Card>
      ) : (
        groups.map(([category, rows]) => (
          <Card key={category} style={{ marginBottom: "var(--space-4)" }}>
            <h2 style={{ marginBottom: "var(--space-3)" }}>{category}</h2>
            <table>
              <thead>
                <tr>
                  <th>Servicio</th>
                  <th>Duración</th>
                  <th>Precio</th>
                  <th>Activo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button type="button" className="link-button" onClick={() => setEditing(s)}>
                        {s.name}
                      </button>
                      {!s.is_active ? (
                        <>
                          {" "}
                          <Badge tone="neutral">Inactivo</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>{s.duration_minutes} min</td>
                    <td>{formatPrice(s.price)}</td>
                    <td>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={s.is_active}
                        disabled={pendingId === s.id}
                        aria-label={`Servicio activo: ${s.name}`}
                        onChange={(e) => handleToggle(s, e.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}

      <ServiceFormSheet open={createOpen} onClose={() => setCreateOpen(false)} tenantId={tenantId} mode="create" />
      <ServiceFormSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        tenantId={tenantId}
        mode="edit"
        service={editing}
        canDelete={canDelete}
      />
    </div>
  )
}
```

- [ ] **Step 3: Agregar la clase `.link-button` a `apps/web/app/globals.css`**

`ServicesList` abre el Sheet de edición desde el nombre del servicio. En Clientes ese nombre es un `<Link>` a la ficha, pero acá no hay ruta de detalle: tiene que ser un `<button>` que *parezca* un link. Esa clase todavía no existe en el design system — hay que agregarla.

Al final del bloque `/* Table */` de `globals.css` (después de la regla `tbody tr:hover`, hoy línea 683, justo antes del comentario `Módulo Agenda`), agregar:

```css
/* Nombre clickeable dentro de una tabla cuando la acción abre un panel en
   vez de navegar a otra ruta (ej. Servicios): se lee como link pero es un
   <button>, que es el rol semántico correcto para "abrir un diálogo". */
.link-button {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--color-primary);
  text-align: left;
  cursor: pointer;
}

.link-button:hover {
  text-decoration: underline;
}

.link-button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

El `:focus-visible` no es opcional: la sección 9 del design system exige ring de foco visible de 2px en `--color-accent` con offset 2px en **todos** los controles interactivos, no solo en los botones primarios.

- [ ] **Step 3b: Verificar que compila**

Run: `pnpm --filter @beautycrm/web exec tsc --noEmit`

Expected: sin errores.

- [ ] **Step 4: Reemplazar `apps/web/app/dashboard/servicios/page.tsx`**

Contenido completo del archivo (borra el `ComingSoon`):

```tsx
import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getServices } from "@/lib/service-queries"
import { ServicesList } from "./ServicesList"

export default async function ServiciosPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const services = await getServices(membership.tenant_id)

  return (
    <div>
      <h1>Servicios</h1>
      {/* role viaja hasta el Sheet para decidir si se muestra "Eliminar
          servicio": services_delete es owner-only. El layout de /dashboard
          ya sacó a las operadoras, así que acá role es owner o supervisor. */}
      <ServicesList tenantId={membership.tenant_id} services={services} role={membership.role} />
    </div>
  )
}
```

- [ ] **Step 5: Activar el módulo en el sidebar**

En `apps/web/components/Sidebar.tsx:30`, cambiar:

```tsx
  { href: "/dashboard/servicios", label: "Servicios", icon: Scissors, implemented: false },
```

por:

```tsx
  { href: "/dashboard/servicios", label: "Servicios", icon: Scissors, implemented: true },
```

- [ ] **Step 6: Verificación manual en el browser**

Run: `pnpm dev`, entrar a `/dashboard/servicios` con un usuario dueño.

Verificar:
1. El link "Servicios" del sidebar ya no tiene el badge "Pronto" y es clickeable.
2. Sin servicios cargados aparece el `EmptyState` con el botón "Agregar el primer servicio".
3. Crear dos servicios con la misma categoría y uno sin categoría → quedan en dos tablas, y la de "Sin categoría" va última.
4. Clic en el nombre de un servicio abre el Sheet en modo edición con los valores cargados.
5. Destildar el switch de una fila la marca con el badge "Inactivo" sin recargar la página a mano.
6. El precio se ve como `$12.000,00` y la duración como `45 min`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/dashboard/servicios apps/web/app/globals.css apps/web/components/Sidebar.tsx
git commit -m "feat(web): módulo Servicios — catálogo agrupado, alta/edición y activación"
```

---

## Task 4: E2E del recorrido completo

**Files:**
- Create: `apps/web/tests/e2e/servicios.spec.ts`

**Interfaces:**
- Consumes de Task 3: los selectores listados en su bloque Interfaces.
- Produces: nada (es la última task).

- [ ] **Step 1: Escribir el spec**

Crear `apps/web/tests/e2e/servicios.spec.ts`:

```ts
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
let tenantId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
    await admin.from("services").delete().eq("tenant_id", tenantId)
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
  await page.getByRole("switch", { name: "Servicio activo: Corte E2E" }).uncheck()
  await expect(page.getByText("Inactivo")).toBeVisible({ timeout: 10_000 })

  // --- La consecuencia real: ya no se ofrece al crear un turno ---
  await page.goto(`${baseURL}/dashboard/agenda`)
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible()
  await page.getByRole("button", { name: "Nuevo turno" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo turno" })).toBeVisible()
  await expect(page.getByRole("checkbox", { name: /Corte E2E/ })).toHaveCount(0)
})
```

- [ ] **Step 2: Levantar la app y correr el spec**

Run (en una terminal): `pnpm dev`
Run (en otra): `pnpm --filter @beautycrm/web exec playwright test tests/e2e/servicios.spec.ts`

Expected: PASS.

Si el botón que abre el modal de nuevo turno en `/dashboard/agenda` no se llama exactamente "Nuevo turno", ajustar ese selector mirando `apps/web/tests/e2e/agenda.spec.ts:107-109`, que ya hace ese mismo paso — no inventar un selector nuevo.

- [ ] **Step 3: Correr la suite E2E completa para verificar que no rompimos nada**

Run: `pnpm test:e2e`

Expected: PASS en `agenda.spec.ts`, `clientes.spec.ts`, `onboarding.spec.ts` y `servicios.spec.ts`. La activación del sidebar (Task 3, Step 5) es el cambio con más chance de afectar a otro spec, porque cambia el markup de navegación que ven todas las páginas.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e/servicios.spec.ts
git commit -m "test(web): E2E de Servicios — alta, agrupado, edición y desactivación"
```

---

## Cobertura de la spec

| Requisito de la spec | Dónde se cumple |
|---|---|
| Sin migración nueva | Global Constraints; ninguna task toca `migrations/` |
| `getServices(tenantId)` ordenado por category, name | Task 2, Step 2 |
| `createService` / `updateService` | Task 2, Step 3 |
| `toggleServiceActive` sin confirmación | Task 2, Step 3 + Task 3, Step 2 (`handleToggle`) |
| `deleteService` mapea `23503` | Task 2, Step 3 |
| No tocar `agenda-queries.ts` | Global Constraints |
| Agrupado por categoría, "Sin categoría" para null/vacío | Task 3, Step 2 (`groups`) |
| Toggle activo/inactivo por fila | Task 3, Step 2 |
| Sheet reutilizable create/edit | Task 3, Step 1 |
| Sidebar `implemented: true` | Task 3, Step 5 |
| Precio con `Intl.NumberFormat("es-AR")`, duración `"60 min"` | Task 3, Step 2 (`formatPrice`, celda de duración) |
| Validación: nombre, duración > 0, precio ≥ 0 | Task 2, Step 3 (`validateInput`) y Task 3, Step 1 (`handleSubmit`) |
| Sin búsqueda | Ninguna task la agrega |
| `EmptyState` con acción | Task 3, Step 2 |
| Sin realtime, `router.refresh()` | Task 3, Steps 1-3 |
| Tests de seguridad 1-6 | Task 1, Step 1 |
| E2E completo con cruce a Agenda | Task 4, Step 1 |
