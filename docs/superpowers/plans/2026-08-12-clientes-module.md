# Módulo Clientes — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el frontend del módulo Clientes de BeautyCRM: listado con búsqueda instantánea en `/dashboard/clientes`, ficha individual con historial estético en `/dashboard/clientes/[id]`, y el andamiaje de datos (tipos, queries, server actions) que los soporta — para Dueño/Supervisor únicamente.

**Architecture:** Next.js 14 App Router + Supabase (RLS), mismo patrón que el módulo Agenda ya en producción: Server Components para las lecturas iniciales, Client Components para interacción (filtro instantáneo, Sheet de alta/edición, edición inline de notas), Server Actions para las mutaciones. Sin librerías nuevas, sin realtime (no hace falta reflejar cambios de otra pestaña al instante en este módulo).

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript strict, Supabase (`@supabase/ssr`), `@beautycrm/ui`, `@phosphor-icons/react`, Playwright.

## Global Constraints

- Repo: `SaaS-BeautyCRM` (monorepo pnpm: `apps/web`, `packages/ui`, `packages/supabase`).
- Proyecto Supabase: `xhbrhpfzehshiyjzlxnx` (región `sa-east-1`).
- Tenants de prueba: descartables, provisionados vía admin API (mismo patrón que `tests/e2e/agenda.spec.ts`) — nunca el tenant real `fab8b076-ed53-41c3-bfd6-c581af97fe56`.
- No agregar dependencias nuevas.
- Toda copy de UI en español, tono como el resto de la app (ver `docs/ui-design-system.md`).
- Server Actions devuelven `{ ok: true, data } | { ok: false, error }` — mismo patrón `ActionResult<T>` que `lib/agenda-actions.ts`.
- RLS es la barrera de verdad. La validación client-side es feedback inmediato, nunca la única barrera.
- No editar `packages/supabase/src/types.ts` a mano — se regenera (Task 1).
- No tocar `apps/web/lib/agenda-actions.ts` ni `apps/web/app/o/cliente/actions.ts` — son flujos ya en producción, fuera de alcance de este módulo.
- Design tokens: usar las variables CSS ya definidas en `apps/web/app/globals.css`. No hardcodear valores.
- Spec completo: `docs/superpowers/specs/2026-08-12-clientes-module-design.md`.

---

## Task 1: Migración 0009 y regenerar `types.ts`

**Files:**
- Create: `migrations/0009_client_history_module.sql`
- Modify: `packages/supabase/src/types.ts` (regenerado, no a mano)

**Interfaces:**
- Produces: policy `client_history_update` (permite UPDATE de `client_history` a owner/supervisor) y la vista `public.v_client_history` quedan disponibles en `Database["public"]["Views"]` para las Tasks siguientes.

- [ ] **Step 1: Escribir `migrations/0009_client_history_module.sql`**

```sql
-- ============================================================================
-- BeautyCRM — 0009_client_history_module.sql
-- Módulo Clientes: permite editar client_history (hoy solo se puede
-- insertar, vía el trigger de Agenda y vía app/o/cliente/actions.ts) y
-- agrega una vista de lectura resuelta con nombre de servicio/operadora/
-- sucursal ya armados, mismo criterio que v_agenda (0007_agenda_module).
-- ============================================================================

-- Restringido a owner/supervisor: mismo criterio que clients_delete
-- (0001_initial_schema), y este módulo entero vive bajo /dashboard, que ya
-- es owner/supervisor-only (dashboard/layout.tsx redirige operadoras a /o).
-- OJO: esta policy controla QUÉ FILAS se pueden tocar, no qué columnas —
-- la barrera de "solo se edita technical_notes" es de la Server Action
-- (Task 4: updateHistoryNotes hace .update({ technical_notes }) explícito,
-- nunca un update genérico), no de RLS.
create policy client_history_update on public.client_history for update
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));

-- v_client_history: lectura resuelta para la ficha del cliente.
-- security_invoker=true: respeta las RLS de client_history/services/
-- users/branches, no las bypassea. Nota: puede haber filas con
-- service_id NULL (apps/web/app/o/cliente/actions.ts inserta notas de la
-- operadora sin servicio asociado) — ahí service_name sale NULL, es
-- comportamiento esperado, no un bug de la vista.
create or replace view public.v_client_history
with (security_invoker = true) as
select
  ch.id, ch.tenant_id, ch.client_id, ch.appointment_id,
  ch.service_id, s.name as service_name,
  ch.operator_id, u.full_name as operator_name,
  ch.branch_id, b.name as branch_name,
  ch.performed_at, ch.technical_notes, ch.photos
from client_history ch
left join services s on s.id = ch.service_id
left join users u on u.id = ch.operator_id
left join branches b on b.id = ch.branch_id;
```

- [ ] **Step 2: Aplicar la migración**

Usar la tool MCP de Supabase `apply_migration` para el proyecto `xhbrhpfzehshiyjzlxnx` con el nombre `client_history_module` y el SQL de arriba.

- [ ] **Step 3: Regenerar `packages/supabase/src/types.ts`**

Usar la tool MCP de Supabase `generate_typescript_types` para el proyecto `xhbrhpfzehshiyjzlxnx` y escribir el resultado completo en `packages/supabase/src/types.ts`, reemplazando el archivo entero (mantiene el mismo comentario de cabecera "Generado desde el proyecto Supabase real... NO editar a mano").

Verificar que el archivo resultante incluye `v_client_history` bajo `Views`.

- [ ] **Step 4: Verificar que el resto del repo sigue compilando**

Run: `pnpm --filter @beautycrm/web build`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add migrations/0009_client_history_module.sql packages/supabase/src/types.ts
git commit -m "$(cat <<'EOF'
chore(db): policy de UPDATE en client_history y vista v_client_history

client_history solo tenía policies de select/insert — sin UPDATE no se
puede editar una nota técnica desde ningún lado. Se agrega, restringida a
owner/supervisor. v_client_history resuelve service_name/operator_name/
branch_name para la ficha del cliente, mismo patrón que v_agenda.
EOF
)"
```

---

## Task 2: Tipos de Clientes (`lib/client-types.ts`)

**Files:**
- Create: `apps/web/lib/client-types.ts`

**Interfaces:**
- Consumes: `Tables<"clients">` de `@beautycrm/supabase/types` (Task 1).
- Produces: `ClientRecord`, `ClientHistoryEntry`, `ClientSummary`, `ClientDetail`. Los consumen las Tasks 3-7.

- [ ] **Step 1: Escribir `apps/web/lib/client-types.ts`**

```ts
import type { Tables } from "@beautycrm/supabase/types"

export type ClientRecord = Tables<"clients">

export type ClientHistoryEntry = {
  id: string
  appointment_id: string | null
  service_id: string | null
  service_name: string | null
  operator_id: string | null
  operator_name: string | null
  branch_id: string | null
  branch_name: string | null
  performed_at: string
  technical_notes: string | null
}

export type ClientSummary = {
  visitCount: number
  lastVisitAt: string | null
}

export type ClientDetail = {
  client: ClientRecord
  history: ClientHistoryEntry[]
  summary: ClientSummary
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/client-types.ts
git commit -m "feat(web): tipos base del módulo Clientes"
```

---

## Task 3: Lecturas server-side (`lib/client-queries.ts`)

**Files:**
- Create: `apps/web/lib/client-queries.ts`

**Interfaces:**
- Consumes: `ClientRecord`, `ClientHistoryEntry`, `ClientDetail` de `lib/client-types.ts` (Task 2).
- Produces: `getClients(tenantId)`, `getClientDetail(tenantId, clientId)`. Los consumen Task 6 (`/dashboard/clientes/page.tsx`) y Task 7 (`/dashboard/clientes/[id]/page.tsx`).

- [ ] **Step 1: Escribir `apps/web/lib/client-queries.ts`**

```ts
import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { ClientDetail, ClientHistoryEntry, ClientRecord } from "./client-types"

export async function getClients(tenantId: string): Promise<ClientRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase.from("clients").select("*").eq("tenant_id", tenantId).order("full_name")

  return data ?? []
}

export async function getClientDetail(tenantId: string, clientId: string): Promise<ClientDetail | null> {
  const supabase = await createClient()

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", clientId)
    .maybeSingle()

  if (!client) return null

  const { data: historyRows } = await supabase
    .from("v_client_history")
    .select(
      "id, appointment_id, service_id, service_name, operator_id, operator_name, branch_id, branch_name, performed_at, technical_notes"
    )
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .order("performed_at", { ascending: false })
    .returns<ClientHistoryEntry[]>()

  const history = historyRows ?? []

  // "Visitas" cuenta appointment_id DISTINTOS, no filas crudas: un turno
  // con 2 servicios genera 2 filas en client_history (una por servicio),
  // y contarlas tal cual infla la cifra respecto a lo que el dueño espera
  // ver como "cuántas veces vino".
  const distinctAppointments = new Set(
    history.map((h) => h.appointment_id).filter((id): id is string => id !== null)
  )

  return {
    client,
    history,
    summary: {
      visitCount: distinctAppointments.size,
      lastVisitAt: history.length > 0 ? history[0].performed_at : null,
    },
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/client-queries.ts
git commit -m "feat(web): lecturas server-side de clientes y v_client_history"
```

---

## Task 4: Server actions (`lib/client-actions.ts`)

**Files:**
- Create: `apps/web/lib/client-actions.ts`

**Interfaces:**
- Consumes: `ClientRecord` de `lib/client-types.ts` (Task 2).
- Produces: `createClient(tenantId, input)`, `updateClient(clientId, input)`, `deleteClient(clientId)`, `updateHistoryNotes(historyId, notes)`, tipos `ClientInput`, `ActionResult<T>`. Los consumen Task 5, Task 7.

- [ ] **Step 1: Escribir `apps/web/lib/client-actions.ts`**

```ts
"use server"

// Alias porque este archivo exporta su propia función `createClient` (alta
// de cliente de negocio) — sin el alias colisionaría con el factory de
// Supabase.
import { createClient as createSupabaseClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { ClientRecord } from "./client-types"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type ClientInput = {
  fullName: string
  phone: string | null
  email: string | null
  birthday: string | null
  notes: string | null
}

export async function createClient(tenantId: string, input: ClientInput): Promise<ActionResult<ClientRecord>> {
  if (!input.fullName.trim()) return { ok: false, error: "El nombre es obligatorio." }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase
    .from("clients")
    .insert({
      tenant_id: tenantId,
      full_name: input.fullName.trim(),
      phone: input.phone,
      email: input.email,
      birthday: input.birthday,
      notes: input.notes,
    })
    .select("*")
    .single()

  if (error || !data) return { ok: false, error: "No pudimos crear el cliente." }

  revalidatePath("/dashboard/clientes")
  return { ok: true, data }
}

export async function updateClient(clientId: string, input: ClientInput): Promise<ActionResult<ClientRecord>> {
  if (!input.fullName.trim()) return { ok: false, error: "El nombre es obligatorio." }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  // .select().maybeSingle() en vez de solo comprobar `error`: si RLS
  // bloquea el UPDATE (fila de otro tenant), Postgres no tira error,
  // simplemente actualiza 0 filas — mismo patrón que
  // updateAppointmentStatus en lib/agenda-actions.ts.
  const { data, error } = await supabase
    .from("clients")
    .update({
      full_name: input.fullName.trim(),
      phone: input.phone,
      email: input.email,
      birthday: input.birthday,
      notes: input.notes,
    })
    .eq("id", clientId)
    .select("*")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos actualizar el cliente." }

  revalidatePath("/dashboard/clientes")
  revalidatePath(`/dashboard/clientes/${clientId}`)
  return { ok: true, data }
}

export async function deleteClient(clientId: string): Promise<ActionResult> {
  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase.from("clients").delete().eq("id", clientId).select("id").maybeSingle()

  if (error) {
    // 23503 = foreign_key_violation. clients no tiene ON DELETE CASCADE
    // desde appointments/client_history/sales (migrations/0001) a
    // propósito: un cliente con historial real no se borra silenciosamente.
    if (error.code === "23503") {
      return { ok: false, error: "No se puede eliminar: esta persona tiene turnos o historial asociado." }
    }
    return { ok: false, error: "No pudimos eliminar el cliente." }
  }
  if (!data) return { ok: false, error: "No pudimos eliminar el cliente. Puede que no tengas permiso." }

  revalidatePath("/dashboard/clientes")
  return { ok: true, data: undefined }
}

export async function updateHistoryNotes(historyId: string, notes: string): Promise<ActionResult> {
  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase
    .from("client_history")
    .update({ technical_notes: notes })
    .eq("id", historyId)
    .select("id")
    .maybeSingle()

  if (error || !data) return { ok: false, error: "No pudimos guardar la nota. Puede que no tengas permiso." }

  return { ok: true, data: undefined }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/client-actions.ts
git commit -m "feat(web): server actions de Clientes (alta, edición, borrado, nota técnica)"
```

---

## Task 5: `ClientFormSheet` — alta y edición

**Files:**
- Create: `apps/web/app/dashboard/clientes/ClientFormSheet.tsx`

**Interfaces:**
- Consumes: `Sheet`, `Button`, `Field`, `Input` de `@beautycrm/ui`; `createClient`, `updateClient`, `ClientInput` de `@/lib/client-actions`; `ClientRecord` de `@/lib/client-types`.
- Produces: `<ClientFormSheet open onClose tenantId mode client>`. Lo consumen Task 6 (alta) y Task 7 (edición).

- [ ] **Step 1: Escribir `apps/web/app/dashboard/clientes/ClientFormSheet.tsx`**

```tsx
"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { createClient, updateClient, type ClientInput } from "@/lib/client-actions"
import type { ClientRecord } from "@/lib/client-types"

export function ClientFormSheet({
  open,
  onClose,
  tenantId,
  mode,
  client,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  mode: "create" | "edit"
  client?: ClientRecord | null
}) {
  const router = useRouter()
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [birthday, setBirthday] = useState("")
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFullName(client?.full_name ?? "")
    setPhone(client?.phone ?? "")
    setEmail(client?.email ?? "")
    setBirthday(client?.birthday ?? "")
    setNotes(client?.notes ?? "")
    setError(null)
  }, [open, client])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fullName.trim()) {
      setError("El nombre es obligatorio.")
      return
    }

    const input: ClientInput = {
      fullName,
      phone: phone.trim() || null,
      email: email.trim() || null,
      birthday: birthday || null,
      notes: notes.trim() || null,
    }

    setLoading(true)
    const result = mode === "create" ? await createClient(tenantId, input) : await updateClient(client!.id, input)
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === "create" ? "Nuevo cliente" : "Editar cliente"} side="right">
      <form onSubmit={handleSubmit}>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Nombre" htmlFor="client-full-name">
          <Input id="client-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>

        <Field label="Teléfono" htmlFor="client-phone">
          <Input id="client-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>

        <Field label="Email" htmlFor="client-email">
          <Input id="client-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <Field label="Cumpleaños" htmlFor="client-birthday">
          <Input id="client-birthday" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </Field>

        <Field label="Notas" htmlFor="client-notes">
          <textarea id="client-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : mode === "create" ? "Crear cliente" : "Guardar cambios"}
        </Button>
      </form>
    </Sheet>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/dashboard/clientes/ClientFormSheet.tsx
git commit -m "feat(web): ClientFormSheet — alta y edición de cliente"
```

---

## Task 6: Ruta `/dashboard/clientes` (listado)

**Files:**
- Create: `apps/web/app/dashboard/clientes/ClientesList.tsx`
- Modify: `apps/web/app/dashboard/clientes/page.tsx` (reemplaza el stub `ComingSoon`)
- Modify: `apps/web/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `getClients` de `@/lib/client-queries` (Task 3); `ClientFormSheet` (Task 5); `ClientRecord` de `@/lib/client-types` (Task 2); `getCurrentMembership` de `@/lib/session`.
- Produces: la ruta `/dashboard/clientes` queda navegable y sin el badge "Pronto" en el sidebar.

- [ ] **Step 1: Escribir `apps/web/app/dashboard/clientes/ClientesList.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Users, Plus } from "@phosphor-icons/react"
import { Button, Card, EmptyState, Input } from "@beautycrm/ui"
import type { ClientRecord } from "@/lib/client-types"
import { ClientFormSheet } from "./ClientFormSheet"

export function ClientesList({ tenantId, clients }: { tenantId: string; clients: ClientRecord[] }) {
  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.full_name.toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q))
  }, [clients, query])

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-4)",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <Input
          placeholder="Buscar por nombre o teléfono..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 320, flex: 1 }}
        />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} weight="bold" /> Nuevo cliente
        </Button>
      </div>

      <Card>
        {clients.length === 0 ? (
          <EmptyState
            icon={<Users size={24} weight="regular" />}
            title="Todavía no hay clientes"
            description="Se cargan acá o automáticamente desde el modal de nuevo turno en Agenda."
            action={<Button onClick={() => setCreateOpen(true)}>Nuevo cliente</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={24} weight="regular" />}
            title="Sin resultados"
            description={`No encontramos a nadie que coincida con "${query}".`}
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/dashboard/clientes/${c.id}`}>{c.full_name}</Link>
                  </td>
                  <td>{c.phone ?? "—"}</td>
                  <td>{c.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <ClientFormSheet open={createOpen} onClose={() => setCreateOpen(false)} tenantId={tenantId} mode="create" />
    </div>
  )
}
```

- [ ] **Step 2: Reemplazar `apps/web/app/dashboard/clientes/page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getClients } from "@/lib/client-queries"
import { ClientesList } from "./ClientesList"

export default async function ClientesPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const clients = await getClients(membership.tenant_id)

  return (
    <div>
      <h1>Clientes</h1>
      <ClientesList tenantId={membership.tenant_id} clients={clients} />
    </div>
  )
}
```

- [ ] **Step 3: Activar el ítem en `apps/web/components/Sidebar.tsx`**

Cambiar la línea del ítem de Clientes:

```ts
  { href: "/dashboard/clientes", label: "Clientes", icon: Users, implemented: false },
```

por:

```ts
  { href: "/dashboard/clientes", label: "Clientes", icon: Users, implemented: true },
```

- [ ] **Step 4: Verificar tipos y build**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json && cd .. && pnpm --filter @beautycrm/web build`
Expected: sin errores, build exitoso.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/clientes/ClientesList.tsx apps/web/app/dashboard/clientes/page.tsx apps/web/components/Sidebar.tsx
git commit -m "feat(web): activar /dashboard/clientes — listado con búsqueda y alta"
```

---

## Task 7: Ruta `/dashboard/clientes/[id]` (ficha)

**Files:**
- Create: `apps/web/app/dashboard/clientes/[id]/page.tsx`
- Create: `apps/web/app/dashboard/clientes/[id]/ClientDetailView.tsx`
- Create: `apps/web/app/dashboard/clientes/[id]/ClientHistoryTable.tsx`

**Interfaces:**
- Consumes: `getClientDetail` de `@/lib/client-queries` (Task 3); `deleteClient`, `updateHistoryNotes` de `@/lib/client-actions` (Task 4); `ClientFormSheet` (Task 5); `ClientDetail`, `ClientHistoryEntry` de `@/lib/client-types` (Task 2).
- Produces: la ruta `/dashboard/clientes/[id]` queda navegable desde el listado (Task 6).

- [ ] **Step 1: Escribir `apps/web/app/dashboard/clientes/[id]/ClientHistoryTable.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@beautycrm/ui"
import { updateHistoryNotes } from "@/lib/client-actions"
import type { ClientHistoryEntry } from "@/lib/client-types"

export function ClientHistoryTable({ history }: { history: ClientHistoryEntry[] }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [savingId, setSavingId] = useState<string | null>(null)

  function startEdit(entry: ClientHistoryEntry) {
    setEditingId(entry.id)
    setDraft(entry.technical_notes ?? "")
  }

  async function save(entryId: string) {
    setSavingId(entryId)
    const result = await updateHistoryNotes(entryId, draft)
    setSavingId(null)
    if (!result.ok) return
    setEditingId(null)
    router.refresh()
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Servicio</th>
          <th>Operadora</th>
          <th>Nota técnica</th>
        </tr>
      </thead>
      <tbody>
        {history.map((entry) => (
          <tr key={entry.id}>
            <td>{new Date(entry.performed_at).toLocaleDateString("es-AR")}</td>
            {/* service_name puede ser null: apps/web/app/o/cliente/actions.ts
                inserta notas de la operadora sin servicio asociado (ver
                spec, sección "Dato real: addTechnicalNote existente"). */}
            <td>{entry.service_name ?? "Nota"}</td>
            <td>{entry.operator_name ?? "—"}</td>
            <td>
              {editingId === entry.id ? (
                <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
                  <textarea className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <Button type="button" onClick={() => save(entry.id)} disabled={savingId === entry.id}>
                    {savingId === entry.id ? "Guardando..." : "Guardar"}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(entry)}
                  style={{
                    background: "none",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    padding: 0,
                    font: "var(--text-small)",
                  }}
                >
                  {entry.technical_notes ?? <span style={{ color: "var(--color-ink-soft)" }}>Agregar nota</span>}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 2: Escribir `apps/web/app/dashboard/clientes/[id]/ClientDetailView.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PencilSimple, Trash, ClockCounterClockwise } from "@phosphor-icons/react"
import { Button, Card, EmptyState, StatTile } from "@beautycrm/ui"
import { deleteClient } from "@/lib/client-actions"
import type { ClientDetail } from "@/lib/client-types"
import { ClientFormSheet } from "../ClientFormSheet"
import { ClientHistoryTable } from "./ClientHistoryTable"

export function ClientDetailView({ tenantId, detail }: { tenantId: string; detail: ClientDetail }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { client, history, summary } = detail

  async function handleDelete() {
    if (!window.confirm(`¿Eliminar a ${client.full_name}? Esta acción no se puede deshacer.`)) return
    setDeleting(true)
    const result = await deleteClient(client.id)
    setDeleting(false)
    if (!result.ok) {
      window.alert(result.error)
      return
    }
    router.push("/dashboard/clientes")
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "var(--space-6)",
          gap: "var(--space-4)",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1>{client.full_name}</h1>
          <p style={{ color: "var(--color-ink-soft)" }}>
            {[client.phone, client.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
          </p>
          {client.birthday ? (
            <p style={{ color: "var(--color-ink-soft)" }}>
              Cumpleaños: {new Date(client.birthday).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}
            </p>
          ) : null}
          {client.notes ? <p>{client.notes}</p> : null}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            <PencilSimple size={16} weight="bold" /> Editar
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            <Trash size={16} weight="bold" /> {deleting ? "Eliminando..." : "Eliminar"}
          </Button>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <StatTile label="Visitas" value={summary.visitCount} />
        <StatTile
          label="Última visita"
          value={summary.lastVisitAt ? new Date(summary.lastVisitAt).toLocaleDateString("es-AR") : "—"}
        />
      </div>

      <Card>
        <h2>Historial</h2>
        {history.length === 0 ? (
          <EmptyState
            icon={<ClockCounterClockwise size={24} weight="regular" />}
            title="Sin historial todavía"
            description="Cuando se complete un turno de esta persona, va a aparecer acá."
          />
        ) : (
          <ClientHistoryTable history={history} />
        )}
      </Card>

      <ClientFormSheet open={editOpen} onClose={() => setEditOpen(false)} tenantId={tenantId} mode="edit" client={client} />
    </div>
  )
}
```

- [ ] **Step 3: Escribir `apps/web/app/dashboard/clientes/[id]/page.tsx`**

```tsx
import { redirect, notFound } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getClientDetail } from "@/lib/client-queries"
import { ClientDetailView } from "./ClientDetailView"

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const { id } = await params
  const detail = await getClientDetail(membership.tenant_id, id)
  if (!detail) notFound()

  return <ClientDetailView tenantId={membership.tenant_id} detail={detail} />
}
```

- [ ] **Step 4: Verificar tipos y build**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json && cd .. && pnpm --filter @beautycrm/web build`
Expected: sin errores, build exitoso.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/clientes/[id]
git commit -m "feat(web): ficha de cliente — datos, resumen de visitas, historial y notas técnicas"
```

---

## Task 8: Test de comportamiento a nivel de datos

**Files:**
- Create: `apps/web/tests/security/clientes-behavior.test.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json` (raíz)

**Interfaces:**
- Consumes: nada de las tasks anteriores (habla directo con Supabase, mismo patrón que `tests/security/agenda-behavior.test.ts`).
- Produces: `pnpm test:clientes` ejecutable desde la raíz.

- [ ] **Step 1: Escribir `apps/web/tests/security/clientes-behavior.test.ts`**

```ts
/**
 * Invariantes del módulo Clientes que conviene chequear a nivel de datos:
 * borrado restringido a owner/supervisor, edición de nota técnica
 * restringida a owner/supervisor, y que borrar un cliente con historial
 * falla por FK (a propósito, no un bug). Mismo patrón que
 * tests/security/agenda-behavior.test.ts: datos 100% descartables contra
 * el proyecto real, borrados en el finally.
 *
 * Ejecutar: pnpm test:clientes (desde apps/web, con .env.local cargado)
 */
import { createClient } from "@supabase/supabase-js"
import assert from "node:assert/strict"

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
  const email = `clientes-test-${label}-${Date.now()}@example.com`
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
  let clientId: string | undefined
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Clientes Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id

    console.log("Creando operadora y cliente...")
    const operatorUser = await createTestUser("operator")
    userIds.push(operatorUser.id)
    const operatorClient = await signIn(operatorUser.email, operatorUser.password)

    const { error: membershipError } = await admin.from("memberships").insert({
      tenant_id: tenantId,
      user_id: operatorUser.id,
      branch_id: null,
      role: "operator",
    })
    if (membershipError) throw new Error(`No pude crear membership operador: ${membershipError.message}`)

    const { data: client, error: clientError } = await ownerClient
      .from("clients")
      .insert({ tenant_id: tenantId, full_name: "Cliente de prueba" })
      .select()
      .single()
    if (clientError || !client) throw new Error(`No pude crear cliente: ${clientError?.message}`)
    clientId = client.id

    const { data: historyRow, error: historyError } = await admin
      .from("client_history")
      .insert({ tenant_id: tenantId, client_id: clientId, operator_id: operatorUser.id, technical_notes: null })
      .select()
      .single()
    if (historyError || !historyRow) throw new Error(`No pude crear client_history: ${historyError?.message}`)

    // --- Test 1: operador no puede editar la nota técnica ---
    console.log("Test 1: operador no puede editar technical_notes...")
    const { data: operatorUpdate } = await operatorClient
      .from("client_history")
      .update({ technical_notes: "nota de operador" })
      .eq("id", historyRow.id)
      .select("id")
    if (operatorUpdate && operatorUpdate.length > 0) {
      console.error("  FALLO — el operador pudo editar la nota técnica")
      failures++
    } else {
      console.log("  OK — 0 filas afectadas (RLS bloqueó)")
    }

    // --- Test 2: dueño sí puede editar la nota técnica ---
    console.log("Test 2: el dueño puede editar technical_notes...")
    const { data: ownerUpdate, error: ownerUpdateError } = await ownerClient
      .from("client_history")
      .update({ technical_notes: "tono 7.3" })
      .eq("id", historyRow.id)
      .select("technical_notes")
      .maybeSingle()
    if (ownerUpdateError || ownerUpdate?.technical_notes !== "tono 7.3") {
      console.error("  FALLO — el dueño no pudo editar la nota técnica:", ownerUpdateError?.message)
      failures++
    } else {
      console.log("  OK — nota actualizada")
    }

    // --- Test 3: operador no puede borrar el cliente ---
    console.log("Test 3: operador no puede borrar un cliente...")
    const { data: operatorDelete } = await operatorClient.from("clients").delete().eq("id", clientId).select("id")
    const { data: stillThere } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle()
    if ((operatorDelete && operatorDelete.length > 0) || !stillThere) {
      console.error("  FALLO — el operador pudo borrar el cliente")
      failures++
    } else {
      console.log("  OK — 0 filas afectadas (RLS bloqueó), el cliente sigue existiendo")
    }

    // --- Test 4: el dueño no puede borrar un cliente con historial (FK) ---
    console.log("Test 4: borrar un cliente con historial falla por FK (a propósito)...")
    const { error: ownerDeleteError } = await ownerClient.from("clients").delete().eq("id", clientId)
    if (!ownerDeleteError) {
      console.error("  FALLO — se borró un cliente con client_history asociado, sin error de FK")
      failures++
    } else if (ownerDeleteError.code !== "23503") {
      console.error("  FALLO — falló pero con un código inesperado:", ownerDeleteError.code, ownerDeleteError.message)
      failures++
    } else {
      console.log("  OK — bloqueado por foreign_key_violation (23503)")
    }

    // --- Test 5: el dueño SÍ puede borrar un cliente sin historial ---
    console.log("Test 5: el dueño puede borrar un cliente sin historial...")
    const { data: freeClient, error: freeClientError } = await ownerClient
      .from("clients")
      .insert({ tenant_id: tenantId, full_name: "Cliente sin historial" })
      .select()
      .single()
    if (freeClientError || !freeClient) throw new Error(`No pude crear cliente sin historial: ${freeClientError?.message}`)

    const { data: freeDelete, error: freeDeleteError } = await ownerClient
      .from("clients")
      .delete()
      .eq("id", freeClient.id)
      .select("id")
      .maybeSingle()
    if (freeDeleteError || !freeDelete) {
      console.error("  FALLO — el dueño no pudo borrar un cliente sin historial:", freeDeleteError?.message)
      failures++
    } else {
      console.log("  OK — borrado")
    }
  } finally {
    console.log("Limpiando datos de prueba...")
    if (tenantId) {
      if (clientId) {
        await admin.from("client_history").delete().eq("client_id", clientId)
        await admin.from("clients").delete().eq("id", clientId)
      }
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
    console.error(`\n${failures} test(s) del módulo Clientes FALLARON.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Clientes pasaron.")
}

main().catch((err) => {
  console.error("Error inesperado en el test de Clientes:", err)
  process.exit(1)
})
```

- [ ] **Step 2: Agregar el script a `apps/web/package.json`**

En `"scripts"`, junto a `"test:agenda"`:

```json
    "test:clientes": "tsx --env-file=.env.local tests/security/clientes-behavior.test.ts"
```

- [ ] **Step 3: Agregar el script a `package.json` (raíz)**

En `"scripts"`, junto a `"test:agenda"`:

```json
    "test:clientes": "pnpm --filter @beautycrm/web test:clientes"
```

- [ ] **Step 4: Correr el test**

Run: `pnpm test:clientes`
Expected: `Todos los tests de comportamiento de Clientes pasaron.`

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/security/clientes-behavior.test.ts apps/web/package.json package.json
git commit -m "test(web): invariantes de datos del módulo Clientes (borrado, nota técnica, FK)"
```

---

## Task 9: E2E Playwright del flujo de cliente

**Files:**
- Create: `apps/web/tests/e2e/clientes.spec.ts`

**Interfaces:**
- Consumes: nada de las tasks anteriores directamente (habla contra la app corriendo, mismo patrón que `tests/e2e/agenda.spec.ts`).
- Produces: el spec corre como parte de `pnpm test:e2e`.

- [ ] **Step 1: Escribir `apps/web/tests/e2e/clientes.spec.ts`**

```ts
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

  // --- Editar la nota técnica ---
  await page.getByRole("button", { name: "Agregar nota" }).click()
  await page.locator("textarea").fill("Tono 7.3, sensibilidad en cutícula")
  await page.getByRole("button", { name: "Guardar" }).click()
  await expect(page.getByText("Tono 7.3, sensibilidad en cutícula")).toBeVisible({ timeout: 10_000 })
})
```

- [ ] **Step 2: Correr el test**

Run: `pnpm --filter @beautycrm/web test:e2e -- tests/e2e/clientes.spec.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/clientes.spec.ts
git commit -m "test(web): E2E de Clientes — alta, ficha, y edición de nota técnica"
```

---

## Task 10: Verificación final y checklist manual

**Files:** ninguno nuevo — solo comandos y verificación.

**Interfaces:** N/A (tarea de cierre).

- [ ] **Step 1: Build completo**

Run: `pnpm --filter @beautycrm/web build`
Expected: exitoso.

- [ ] **Step 2: Lint**

Run: `pnpm --filter @beautycrm/web lint`
Expected: sin errores.

- [ ] **Step 3: Suite completa de tests**

Run: `pnpm test:security && pnpm test:agenda && pnpm test:clientes && pnpm --filter @beautycrm/web test:e2e`
Expected: todo en verde.

- [ ] **Step 4: Checklist manual (tenant descartable, no el tenant real)**

Provisionar un tenant descartable vía admin API (mismo patrón que la verificación manual de la Task 13 de Agenda), loguearse como owner, y repasar:

- [ ] El listado en `/dashboard/clientes` muestra el badge "Pronto" ya sacado del sidebar.
- [ ] Buscar por nombre y por teléfono filtra instantáneamente sin recargar.
- [ ] Crear un cliente nuevo lo muestra en el listado sin recargar a mano.
- [ ] Entrar a la ficha muestra visitas=0 y última visita="—" para un cliente recién creado.
- [ ] Completar un turno de Agenda para ese cliente (flujo ya existente) hace que la ficha muestre visitas=1, última visita con la fecha correcta, y una fila de historial con el servicio y la operadora correctos.
- [ ] Editar la nota técnica de esa fila persiste tras refrescar la página.
- [ ] Editar los datos del cliente (teléfono, email, cumpleaños, notas) desde "Editar" persiste.
- [ ] Intentar eliminar ese cliente (con historial) muestra el mensaje "No se puede eliminar: esta persona tiene turnos o historial asociado." — no un error crudo de Postgres.
- [ ] Crear un segundo cliente sin historial y eliminarlo funciona sin error.
- [ ] Una operadora (rol `operator`) no ve `/dashboard/clientes` — sigue redirigida a `/o`.

- [ ] **Step 5: Confirmar el estado de git**

Run: `git log --oneline -10 && git status`
Expected: 9 commits nuevos de las Tasks 1-9, working tree limpio.

No hay Step de commit en esta tarea — es solo verificación; si algo falla, corregir en la task correspondiente y volver a este checklist.

---

## Fuera de alcance (recordatorio)

- Fotos antes/después en `client_history.photos` (requiere Supabase Storage).
- Paginación del listado (instant-filter en memoria alcanza a la escala actual).
- Segmentación/etiquetado de clientes (VIP, etc.).
- Total gastado por cliente en el resumen (requeriría join a `appointment_services`, no pedido esta vuelta).
- Cambios a `apps/web/lib/agenda-actions.ts` (`createQuickClient`) o `apps/web/app/o/cliente/` — flujos ya en producción, no se tocan.
