# Módulo Agenda — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el frontend del módulo Agenda de BeautyCRM: vista semanal/diaria para Dueño/Supervisor en `/dashboard/agenda`, mejoras a "Mi día" para la operadora en `/o`, y todo el andamiaje de datos (tipos, queries, server actions, realtime) que los soporta.

**Architecture:** Next.js 14 App Router + Supabase (RLS). Server Components hacen las lecturas iniciales (`v_agenda`), Client Components manejan interacción (grilla, modal, panel de detalle) y Server Actions hacen las mutaciones (`book_appointment` RPC, `update` de estado). Sin librerías nuevas: grilla propia en CSS Grid, sin calendar library, sin framework de testing nuevo (se sigue el patrón existente de scripts `tsx` + Playwright).

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript strict, Supabase (`@supabase/ssr`), `@beautycrm/ui` (design system propio), `@phosphor-icons/react`, Playwright.

## Global Constraints

- Repo: `SaaS-BeautyCRM` (monorepo pnpm: `apps/web`, `packages/ui`, `packages/supabase`).
- Proyecto Supabase: `xhbrhpfzehshiyjzlxnx` (región `sa-east-1`).
- Tenant de prueba para verificación manual en navegador: `fab8b076-ed53-41c3-bfd6-c581af97fe56` (login `joaquin.23.ponce@gmail.com`, rol owner, `mode='single'`). Los tests automatizados (Task 11 y 12) **no** usan este tenant — provisionan uno propio descartable, seguiendo el patrón ya establecido en `tests/e2e/onboarding.spec.ts` y `tests/security/tenant-isolation.test.ts`.
- No agregar dependencias nuevas (nada de `react-big-calendar`, `vitest`, etc.) — usar solo lo que ya está en `package.json`.
- Toda copy de UI en español, tono como el resto de la app (ver `docs/ui-design-system.md` y componentes existentes).
- Server Actions devuelven `{ ok: true, data } | { ok: false, error }` — mismo patrón `ActionResult<T>` que `app/onboarding/actions.ts` y `app/o/cliente/actions.ts`.
- RLS es la barrera de verdad para acceso a datos. La validación client-side de solapamiento es feedback inmediato, nunca la única barrera.
- No editar `packages/supabase/src/types.ts` a mano — se regenera (Task 1).
- No re-crear la lógica de `on_appointment_completed` (client_history) en el frontend.
- Design tokens: usar las variables CSS ya definidas en `apps/web/app/globals.css` (`--space-*`, `--color-*`, `--radius-*`, `--text-*`). No hardcodear valores.
- Spec completo: `docs/superpowers/specs/2026-08-10-agenda-module-design.md`.

---

## Task 1: Versionar migraciones 0007/0008 y regenerar `types.ts`

**Files:**
- Create: `migrations/0007_agenda_module.sql`
- Create: `migrations/0008_agenda_advisor_fixes.sql`
- Modify: `packages/supabase/src/types.ts` (regenerado, no a mano)

**Interfaces:**
- Produces: la vista `public.v_agenda` y la función `public.book_appointment(p_branch_id uuid, p_client_id uuid, p_operator_id uuid, p_starts_at timestamptz, p_service_ids uuid[], p_source appointment_source default 'internal')` quedan disponibles en `Database["public"]["Tables"]`/`Views`/`Functions` para todas las tareas siguientes.

Estas dos migraciones ya están **aplicadas** en el proyecto Supabase remoto (confirmado vía `supabase_migrations.schema_migrations`: versiones `20260810223832` y `20260810224021`). Esta tarea es **documentación del historial**, no una re-aplicación — el contenido de abajo fue reconstruido introspectando el estado real de la base (`pg_get_functiondef`, `pg_get_viewdef`, `pg_get_constraintdef`, policies, grants) porque los archivos nunca se versionaron en este repo.

- [ ] **Step 1: Escribir `migrations/0007_agenda_module.sql`**

```sql
-- ============================================================================
-- BeautyCRM — 0007_agenda_module.sql
-- Agenda: turnos sin solapamiento por operador (constraint EXCLUDE), alta
-- transaccional (book_appointment), historial automático al completar
-- (trigger on_appointment_completed) y lectura resuelta para el frontend
-- (vista v_agenda). Las tablas appointments/appointment_services/
-- client_history y sus policies de RLS ya existían desde 0001_initial_schema
-- — acá solo se agrega lo que faltaba para habilitar el módulo.
-- ============================================================================

create extension if not exists btree_gist;

-- Un mismo operador no puede tener dos turnos que se superpongan dentro del
-- mismo tenant, salvo que uno de ellos esté cancelado o sea no-show.
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    tenant_id with =,
    operator_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status not in ('cancelled', 'no_show'));

-- app.book_appointment: valida sucursal/tenant, permisos de quién reserva,
-- calcula ends_at a partir de la duración de los servicios elegidos, y
-- congela price_snapshot. SECURITY DEFINER porque valida permisos a mano
-- (no se apoya en RLS de INSERT para esto) y necesita insertar en dos
-- tablas de forma atómica.
create or replace function app.book_appointment(
  p_branch_id uuid,
  p_client_id uuid,
  p_operator_id uuid,
  p_starts_at timestamptz,
  p_service_ids uuid[],
  p_source appointment_source default 'internal'
)
returns table (appointment_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_duration_minutes int;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_service_count int;
begin
  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if v_tenant_id not in (select app.user_tenant_ids()) then
    raise exception 'NOT_A_MEMBER' using errcode = '42501';
  end if;

  if not (
    p_operator_id = auth.uid()
    or app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[])
  ) then
    raise exception 'NOT_ALLOWED_TO_BOOK_FOR_THIS_OPERATOR' using errcode = '42501';
  end if;

  select count(*), coalesce(sum(duration_minutes), 0)
    into v_service_count, v_duration_minutes
  from services
  where id = any(p_service_ids) and tenant_id = v_tenant_id and is_active;

  if v_service_count is null or v_service_count <> array_length(p_service_ids, 1) then
    raise exception 'INVALID_SERVICE_SELECTION' using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);

  begin
    insert into appointments (tenant_id, branch_id, client_id, operator_id, starts_at, ends_at, status, source)
    values (v_tenant_id, p_branch_id, p_client_id, p_operator_id, p_starts_at, v_ends_at, 'booked', p_source)
    returning id into v_appointment_id;
  exception
    when exclusion_violation then
      raise exception 'OPERATOR_BUSY' using errcode = '23P01';
  end;

  insert into appointment_services (appointment_id, service_id, price_snapshot)
  select v_appointment_id, s.id, s.price
  from services s
  where s.id = any(p_service_ids);

  return query select v_appointment_id, p_starts_at, v_ends_at;
end;
$function$;

-- Wrapper público delgado, mismo patrón que public.provision_tenant
-- (0005_public_rpc_wrappers): PostgREST solo expone 'public', las
-- funciones reales de negocio viven en 'app'.
--
-- NOTA HISTÓRICA: acá, en 0007, no se revocó el EXECUTE de PUBLIC sobre
-- esta función — por default en Postgres una función nueva es ejecutable
-- por PUBLIC (incluido 'anon') salvo que se revoque explícitamente. Ese
-- bug de permisos es justamente lo que corrige 0008_agenda_advisor_fixes.
create or replace function public.book_appointment(
  p_branch_id uuid,
  p_client_id uuid,
  p_operator_id uuid,
  p_starts_at timestamptz,
  p_service_ids uuid[],
  p_source appointment_source default 'internal'
)
returns table (appointment_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
security definer
set search_path to 'public'
as $function$
  select * from app.book_appointment(p_branch_id, p_client_id, p_operator_id, p_starts_at, p_service_ids, p_source);
$function$;

-- Al completar un turno (status → 'done'), genera automáticamente las filas
-- de client_history correspondientes a cada servicio del turno. El "not
-- exists" evita duplicar si el trigger corre más de una vez sobre el mismo
-- turno (ej. updates posteriores que no cambian el status).
create or replace function app.on_appointment_completed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'done' and (old.status is distinct from 'done') and new.client_id is not null then
    insert into client_history (tenant_id, client_id, appointment_id, service_id, operator_id, branch_id, performed_at)
    select new.tenant_id, new.client_id, new.id, aps.service_id, new.operator_id, new.branch_id, coalesce(new.ends_at, now())
    from appointment_services aps
    where aps.appointment_id = new.id
      and not exists (
        select 1 from client_history ch
        where ch.appointment_id = new.id and ch.service_id = aps.service_id
      );
  end if;
  return new;
end;
$function$;

create trigger trg_appointment_completed
  after update on public.appointments
  for each row execute function app.on_appointment_completed();

-- v_agenda: lectura resuelta para el calendario (cliente, operadora,
-- servicios y total ya armados) para que el frontend no reconstruya joins a
-- mano. security_invoker=true: la vista corre con los permisos de quien
-- consulta, así que sigue respetando las RLS de appointments/clients/users
-- (una operadora solo ve sus propios turnos acá también).
create or replace view public.v_agenda
with (security_invoker = true) as
select
  a.id,
  a.tenant_id,
  a.branch_id,
  a.status,
  a.starts_at,
  a.ends_at,
  a.source,
  a.google_event_id,
  a.client_id,
  c.full_name as client_name,
  c.phone as client_phone,
  a.operator_id,
  u.full_name as operator_name,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'service_id', s.id,
          'name', s.name,
          'duration_minutes', s.duration_minutes,
          'price_snapshot', aps.price_snapshot
        ) order by s.name
      )
      from appointment_services aps
      join services s on s.id = aps.service_id
      where aps.appointment_id = a.id
    ),
    '[]'::jsonb
  ) as services,
  (
    select coalesce(sum(aps.price_snapshot), 0)
    from appointment_services aps
    where aps.appointment_id = a.id
  ) as total_price
from appointments a
left join clients c on c.id = a.client_id
left join users u on u.id = a.operator_id;
```

- [ ] **Step 2: Escribir `migrations/0008_agenda_advisor_fixes.sql`**

```sql
-- ============================================================================
-- BeautyCRM — 0008_agenda_advisor_fixes.sql
-- Correcciones tras revisar los Security Advisors de Supabase post
-- 0007_agenda_module:
--  1) btree_gist quedó instalada en 'public' — se mueve a 'extensions'
--     (recomendación estándar: no instalar extensiones en el schema public).
--  2) public.book_appointment no tenía el EXECUTE revocado de PUBLIC, así
--     que quedaba invocable por 'anon' — se restringe a 'authenticated',
--     mismo patrón que public.provision_tenant (0005_public_rpc_wrappers).
-- ============================================================================

alter extension btree_gist set schema extensions;

revoke all on function public.book_appointment(uuid, uuid, uuid, timestamptz, uuid[], appointment_source) from public;
grant execute on function public.book_appointment(uuid, uuid, uuid, timestamptz, uuid[], appointment_source) to authenticated;
```

- [ ] **Step 3: Regenerar `packages/supabase/src/types.ts`**

El script `pnpm types:generate` del repo (`supabase gen types typescript --project-id xhbrhpfzehshiyjzlxnx --schema public`) requiere `supabase login` interactivo, que no está disponible en este entorno. Usar en su lugar la tool MCP de Supabase equivalente (`generate_typescript_types` para el proyecto `xhbrhpfzehshiyjzlxnx`) y escribir el resultado completo en `packages/supabase/src/types.ts`, reemplazando el archivo entero (mantiene el mismo comentario de cabecera "Generado desde el proyecto Supabase real... NO editar a mano").

Verificar que el archivo resultante incluye `v_agenda` bajo `Views` y `book_appointment` bajo `Functions`.

- [ ] **Step 4: Verificar que el resto del repo sigue compilando**

Run: `pnpm --filter @beautycrm/web build`
Expected: build exitoso (el resto del código todavía no usa los tipos nuevos, así que no debería haber diferencias — este paso solo confirma que la regeneración de tipos no rompió nada existente).

- [ ] **Step 5: Commit**

```bash
git add migrations/0007_agenda_module.sql migrations/0008_agenda_advisor_fixes.sql packages/supabase/src/types.ts
git commit -m "$(cat <<'EOF'
chore(db): versionar migraciones del módulo Agenda y regenerar tipos

0007_agenda_module y 0008_agenda_advisor_fixes ya estaban aplicadas en
Supabase pero no versionadas en el repo. Se reconstruyen desde el estado
real de la base (introspección) para completar el historial.
EOF
)"
```

---

## Task 2: Librería base de Agenda (tipos, errores, tiempo, realtime)

**Files:**
- Create: `apps/web/lib/agenda-types.ts`
- Create: `apps/web/lib/agenda-errors.ts`
- Create: `apps/web/lib/agenda-time.ts`
- Create: `apps/web/lib/useAgendaRealtime.ts`

**Interfaces:**
- Consumes: nada (son los tipos/helpers base).
- Produces: `AgendaAppointment`, `AgendaServiceItem`, `AgendaStatus`, `AgendaOperator`, `AgendaService` (tipos); `agendaErrorMessage(error)`, `agendaErrorCode(error)`; `buildDaySlots()`, `slotIndexForTime(iso)`, `slotSpanForRange(startIso,endIso)`, `rangesOverlap(aStart,aEnd,bStart,bEnd)`, `startOfWeek(date)`, `addDays(date,days)`, `formatDayLabel(date)`, `formatTime(iso)`; `useAgendaRealtime(tenantId, onChange)`. Todo esto lo consumen las Tasks 4-10.

- [ ] **Step 1: Escribir `apps/web/lib/agenda-types.ts`**

```ts
import type { Database } from "@beautycrm/supabase/types"

export type AgendaStatus = Database["public"]["Enums"]["appointment_status"]

export type AgendaServiceItem = {
  service_id: string
  name: string
  duration_minutes: number
  price_snapshot: number
}

export type AgendaAppointment = {
  id: string
  tenant_id: string
  branch_id: string
  status: AgendaStatus
  starts_at: string
  ends_at: string
  source: string
  google_event_id: string | null
  client_id: string | null
  client_name: string | null
  client_phone: string | null
  operator_id: string | null
  operator_name: string | null
  services: AgendaServiceItem[]
  total_price: number
}

export type AgendaOperator = { id: string; full_name: string | null }

export type AgendaService = { id: string; name: string; duration_minutes: number; price: number }
```

- [ ] **Step 2: Escribir `apps/web/lib/agenda-errors.ts`**

```ts
export const AGENDA_ERROR_MESSAGES: Record<string, string> = {
  OPERATOR_BUSY: "Esa persona ya tiene un turno en ese horario.",
  INVALID_SERVICE_SELECTION: "Uno de los servicios elegidos no existe o está inactivo.",
  NOT_ALLOWED_TO_BOOK_FOR_THIS_OPERATOR: "No podés agendar turnos para otra persona.",
  BRANCH_NOT_FOUND: "Hubo un problema con la configuración de la sucursal. Contactá a soporte.",
  NOT_A_MEMBER: "Hubo un problema con la configuración de la sucursal. Contactá a soporte.",
}

const GENERIC_ERROR = "No se pudo crear el turno. Probá de nuevo."

export function agendaErrorCode(error: { message: string }): string | null {
  return Object.keys(AGENDA_ERROR_MESSAGES).find((code) => error.message.includes(code)) ?? null
}

export function agendaErrorMessage(error: { message: string } | null | undefined): string {
  if (!error) return GENERIC_ERROR
  const code = agendaErrorCode(error)
  return code ? AGENDA_ERROR_MESSAGES[code] : GENERIC_ERROR
}
```

- [ ] **Step 3: Escribir `apps/web/lib/agenda-time.ts`**

```ts
export const AGENDA_DAY_START_HOUR = 8
export const AGENDA_DAY_END_HOUR = 21
export const AGENDA_SLOT_MINUTES = 30

export type AgendaTimeSlot = { hour: number; minute: number; label: string }

export function buildDaySlots(): AgendaTimeSlot[] {
  const slots: AgendaTimeSlot[] = []
  const totalMinutes = (AGENDA_DAY_END_HOUR - AGENDA_DAY_START_HOUR) * 60
  for (let m = 0; m < totalMinutes; m += AGENDA_SLOT_MINUTES) {
    const hour = AGENDA_DAY_START_HOUR + Math.floor(m / 60)
    const minute = m % 60
    slots.push({
      hour,
      minute,
      label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    })
  }
  return slots
}

export function slotIndexForTime(iso: string): number {
  const d = new Date(iso)
  const minutesFromDayStart = (d.getHours() - AGENDA_DAY_START_HOUR) * 60 + d.getMinutes()
  return Math.floor(minutesFromDayStart / AGENDA_SLOT_MINUTES)
}

export function slotSpanForRange(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  return Math.max(1, Math.round((end - start) / 60_000 / AGENDA_SLOT_MINUTES))
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime()
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day // lunes como inicio de semana
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
}
```

- [ ] **Step 4: Escribir `apps/web/lib/useAgendaRealtime.ts`**

```ts
"use client"

import { useEffect, useRef } from "react"
import { createClient } from "@beautycrm/supabase/client"

/**
 * Se suscribe a cambios de `appointments` para este tenant y llama a
 * onChange (normalmente router.refresh()) en cada evento. onChange se
 * guarda en un ref para no tener que resuscribirse en cada render — el
 * canal solo depende de tenantId.
 */
export function useAgendaRealtime(tenantId: string, onChange: () => void) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`agenda-changes-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `tenant_id=eq.${tenantId}` },
        () => onChangeRef.current()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tenantId])
}
```

- [ ] **Step 5: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos relacionados a `lib/agenda-*`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/agenda-types.ts apps/web/lib/agenda-errors.ts apps/web/lib/agenda-time.ts apps/web/lib/useAgendaRealtime.ts
git commit -m "$(cat <<'EOF'
feat(web): librería base del módulo Agenda

Tipos compartidos, mapa de errores del RPC book_appointment en español,
helpers de tiempo para la grilla (slots, solapamiento, semana), y el hook
de suscripción realtime a appointments.
EOF
)"
```

---

## Task 3: Componente `Sheet` (packages/ui) + estilos del módulo

**Files:**
- Create: `packages/ui/src/components/Sheet.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: nada nuevo (usa `@phosphor-icons/react`, ya instalado).
- Produces: `<Sheet open title onClose side="right"|"bottom">` exportado desde `@beautycrm/ui`. Lo consumen Task 7 (`NewAppointmentModal`) y Task 8 (`AppointmentDetailPanel`). Clases CSS `.sheet-*`, `.agenda-*` que consumen las Tasks 6-10.

- [ ] **Step 1: Escribir `packages/ui/src/components/Sheet.tsx`**

```tsx
"use client"

import { useEffect, type ReactNode } from "react"
import { X } from "@phosphor-icons/react"

export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  side?: "right" | "bottom"
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className={`sheet-panel sheet-panel-${side}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Cerrar">
            <X size={20} weight="bold" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Exportar desde `packages/ui/src/index.ts`**

```ts
export { Button } from "./components/Button"
export { Input, Label, Field } from "./components/Input"
export { Card, StatTile } from "./components/Card"
export { EmptyState } from "./components/EmptyState"
export { Badge } from "./components/Badge"
export { Sheet } from "./components/Sheet"
```

- [ ] **Step 3: Agregar estilos a `apps/web/app/globals.css`**

Agregar al final del archivo:

```css
/* ===========================================================================
   Módulo Agenda
   =========================================================================== */

/* Sheet (drawer / bottom-sheet) */

.sheet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(36, 31, 26, 0.4);
  display: flex;
  justify-content: flex-end;
  z-index: 50;
}

.sheet-panel {
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  max-height: 100dvh;
  overflow-y: auto;
}

.sheet-panel-right {
  width: min(420px, 100%);
  height: 100dvh;
}

.sheet-panel-bottom {
  width: 100%;
  max-height: 85dvh;
  align-self: flex-end;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

.sheet-header h2 {
  margin: 0;
}

.sheet-close {
  background: none;
  border: none;
  color: var(--color-ink-soft);
  cursor: pointer;
  padding: var(--space-1);
  display: flex;
}

.sheet-body {
  padding: var(--space-6);
}

@media (max-width: 640px) {
  .sheet-overlay {
    align-items: flex-end;
  }

  .sheet-panel-right {
    width: 100%;
    height: auto;
    max-height: 85dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
}

/* Grilla de agenda (Dueño/Supervisor) */

.agenda-grid {
  display: grid;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow-x: auto;
  background: var(--color-surface);
}

.agenda-grid-corner {
  border-bottom: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  background: var(--color-bg);
}

.agenda-grid-header {
  padding: var(--space-2);
  font: var(--text-small);
  font-weight: 600;
  text-align: center;
  border-bottom: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  background: var(--color-bg);
}

.agenda-grid-time {
  padding: var(--space-1) var(--space-2);
  font: var(--text-micro);
  color: var(--color-ink-soft);
  border-right: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  text-align: right;
}

.agenda-grid-slot {
  border-bottom: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  background: none;
  min-height: 22px;
  cursor: pointer;
  padding: 0;
}

.agenda-grid-slot:hover {
  background: var(--color-bg);
}

.agenda-grid-appointment {
  margin: 2px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-primary);
  background: var(--color-success-bg);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  font: var(--text-small);
  position: relative;
  z-index: 1;
}

.agenda-grid-appointment-time {
  font-weight: 700;
}

.agenda-grid-appointment-services {
  color: var(--color-ink-soft);
  font: var(--text-micro);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agenda-empty-hint {
  color: var(--color-ink-soft);
  padding: var(--space-6);
  text-align: center;
}

/* Modal de nuevo turno */

.agenda-selected-client {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
}

.agenda-client-results {
  list-style: none;
  margin: var(--space-1) 0 0;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.agenda-client-results li button {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
  border: none;
  cursor: pointer;
  font: var(--text-small);
}

.agenda-client-results li button:hover {
  background: var(--color-bg);
}

.agenda-quick-create-toggle {
  margin-top: var(--space-2);
  background: none;
  border: none;
  color: var(--color-primary);
  font: var(--text-small);
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.agenda-quick-create {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
}

.agenda-service-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.agenda-service-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font: var(--text-small);
}

.agenda-preview {
  font: var(--text-small);
  color: var(--color-ink-soft);
  margin: 0 0 var(--space-4);
}

.agenda-detail-time {
  font: var(--text-h3);
  margin: 0 0 var(--space-2);
}

/* Navegación de días (Dueño/Supervisor) */

.agenda-day-tabs {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  overflow-x: auto;
}

.agenda-day-tab {
  flex-shrink: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  font: var(--text-small);
  cursor: pointer;
}

.agenda-day-tab[data-active="true"] {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 600;
}

/* Mi día — estados de turno (operadora) */

.agenda-status-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
  flex-wrap: wrap;
}
```

- [ ] **Step 4: Verificar tipos del paquete UI**

Run: `npx tsc --noEmit -p packages/ui/tsconfig.json`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/Sheet.tsx packages/ui/src/index.ts apps/web/app/globals.css
git commit -m "$(cat <<'EOF'
feat(ui): componente Sheet y estilos del módulo Agenda

Drawer/bottom-sheet genérico para el modal de nuevo turno y el panel de
detalle, más toda la hoja de estilos de la grilla, el modal y las
pestañas de día — usando los design tokens existentes, sin dependencias
nuevas.
EOF
)"
```

---

## Task 4: Lecturas server-side de Agenda (`lib/agenda-queries.ts`)

**Files:**
- Create: `apps/web/lib/agenda-queries.ts`

**Interfaces:**
- Consumes: `AgendaAppointment`, `AgendaOperator`, `AgendaService` de `lib/agenda-types.ts` (Task 2).
- Produces: `getAgendaAppointments(tenantId, rangeStartISO, rangeEndISO, filters?)`, `getBranchOperators(tenantId, branchId?)`, `getActiveServices(tenantId)`, `getDefaultBranch(tenantId)`. Los consumen Task 9 (`/dashboard/agenda/page.tsx`) y Task 10 (`/o/page.tsx`).

- [ ] **Step 1: Escribir `apps/web/lib/agenda-queries.ts`**

```ts
import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { AgendaAppointment, AgendaOperator, AgendaService } from "./agenda-types"

export async function getAgendaAppointments(
  tenantId: string,
  rangeStartISO: string,
  rangeEndISO: string,
  filters?: { branchId?: string | null; operatorId?: string | null }
): Promise<AgendaAppointment[]> {
  const supabase = await createClient()
  let query = supabase
    .from("v_agenda")
    .select("*")
    .eq("tenant_id", tenantId)
    .gte("starts_at", rangeStartISO)
    .lt("starts_at", rangeEndISO)
    .order("starts_at", { ascending: true })

  if (filters?.branchId) query = query.eq("branch_id", filters.branchId)
  if (filters?.operatorId) query = query.eq("operator_id", filters.operatorId)

  const { data } = await query.returns<AgendaAppointment[]>()

  // numeric de Postgres puede llegar como string por JSON — se normaliza acá
  // para que el resto del código pueda operar aritméticamente sin sorpresas.
  return (data ?? []).map((row) => ({
    ...row,
    total_price: Number(row.total_price),
    services: row.services.map((s) => ({ ...s, price_snapshot: Number(s.price_snapshot) })),
  }))
}

type MembershipOperatorRow = {
  user_id: string
  users: { id: string; full_name: string | null } | null
}

export async function getBranchOperators(
  tenantId: string,
  branchId?: string | null
): Promise<AgendaOperator[]> {
  const supabase = await createClient()
  let query = supabase
    .from("memberships")
    .select("user_id, users(id, full_name)")
    .eq("tenant_id", tenantId)
    .eq("role", "operator")

  if (branchId) query = query.eq("branch_id", branchId)

  const { data } = await query.returns<MembershipOperatorRow[]>()
  return (data ?? []).map((m) => m.users).filter((u): u is AgendaOperator => u !== null)
}

export async function getActiveServices(tenantId: string): Promise<AgendaService[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("services")
    .select("id, name, duration_minutes, price")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name")
    .returns<AgendaService[]>()

  return (data ?? []).map((s) => ({ ...s, price: Number(s.price) }))
}

export async function getDefaultBranch(tenantId: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  return data ?? null
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores (las funciones todavía no se consumen desde ninguna página, pero deben tipar bien de forma aislada).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agenda-queries.ts
git commit -m "feat(web): lecturas server-side de v_agenda, operadoras y servicios activos"
```

---

## Task 5: Server actions de Agenda (`lib/agenda-actions.ts`)

**Files:**
- Create: `apps/web/lib/agenda-actions.ts`

**Interfaces:**
- Consumes: `agendaErrorMessage`, `agendaErrorCode` de `lib/agenda-errors.ts` (Task 2); `Database` de `@beautycrm/supabase/types` (Task 1).
- Produces: `bookAppointment(input)`, `updateAppointmentStatus(appointmentId, status)`, `searchClients(tenantId, query)`, `createQuickClient(tenantId, input)`, tipo `ClientSearchResult`, tipo `ActionResult<T>`. Los consumen Task 7, Task 8, Task 10.

- [ ] **Step 1: Escribir `apps/web/lib/agenda-actions.ts`**

```ts
"use server"

import { createClient } from "@beautycrm/supabase/server"
import type { Database } from "@beautycrm/supabase/types"
import { revalidatePath } from "next/cache"
import { agendaErrorCode, agendaErrorMessage } from "./agenda-errors"
import type { AgendaStatus } from "./agenda-types"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

type AppointmentSource = Database["public"]["Enums"]["appointment_source"]

export async function bookAppointment(input: {
  branchId: string
  clientId: string | null
  operatorId: string | null
  startsAt: string
  serviceIds: string[]
  source?: AppointmentSource
}): Promise<ActionResult<{ appointmentId: string; startsAt: string; endsAt: string }>> {
  if (input.serviceIds.length === 0) {
    return { ok: false, error: "Elegí al menos un servicio." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida. Iniciá sesión de nuevo." }

  const { data, error } = await supabase.rpc("book_appointment", {
    p_branch_id: input.branchId,
    p_client_id: input.clientId,
    p_operator_id: input.operatorId,
    p_starts_at: input.startsAt,
    p_service_ids: input.serviceIds,
    p_source: input.source ?? "internal",
  })

  if (error) {
    return { ok: false, error: agendaErrorMessage(error), code: agendaErrorCode(error) }
  }

  const row = data?.[0]
  if (!row) return { ok: false, error: "No pudimos crear el turno. Probá de nuevo." }

  revalidatePath("/dashboard/agenda")
  revalidatePath("/o")

  return {
    ok: true,
    data: { appointmentId: row.appointment_id, startsAt: row.starts_at, endsAt: row.ends_at },
  }
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: AgendaStatus
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { error } = await supabase.from("appointments").update({ status }).eq("id", appointmentId)

  if (error) return { ok: false, error: "No pudimos actualizar el turno." }

  revalidatePath("/dashboard/agenda")
  revalidatePath("/o")

  return { ok: true, data: undefined }
}

export type ClientSearchResult = { id: string; full_name: string; phone: string | null }

export async function searchClients(tenantId: string, query: string): Promise<ClientSearchResult[]> {
  if (query.trim().length < 2) return []

  const supabase = await createClient()
  const { data } = await supabase
    .from("clients")
    .select("id, full_name, phone")
    .eq("tenant_id", tenantId)
    .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
    .order("full_name")
    .limit(10)

  return data ?? []
}

export async function createQuickClient(
  tenantId: string,
  input: { fullName: string; phone: string }
): Promise<ActionResult<ClientSearchResult>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data, error } = await supabase
    .from("clients")
    .insert({ tenant_id: tenantId, full_name: input.fullName, phone: input.phone })
    .select("id, full_name, phone")
    .single()

  if (error || !data) return { ok: false, error: "No pudimos crear el cliente." }

  return { ok: true, data }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores. Si `supabase.rpc("book_appointment", ...)` no tipa, revisar que Task 1 haya regenerado `types.ts` correctamente (debe incluir `book_appointment` en `Functions`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agenda-actions.ts
git commit -m "feat(web): server actions de Agenda (book_appointment, cambio de estado, alta rápida de cliente)"
```

---

## Task 6: `AgendaGrid` — grilla de horarios por operadora

**Files:**
- Create: `apps/web/app/dashboard/agenda/AgendaGrid.tsx`

**Interfaces:**
- Consumes: `AgendaAppointment`, `AgendaOperator` de `@/lib/agenda-types`; `buildDaySlots`, `formatTime`, `slotIndexForTime`, `slotSpanForRange` de `@/lib/agenda-time`; `Badge` de `@beautycrm/ui`.
- Produces: `<AgendaGrid day operators appointments onSlotClick onAppointmentClick>`. Lo consume Task 9 (`AgendaView`).

- [ ] **Step 1: Escribir `apps/web/app/dashboard/agenda/AgendaGrid.tsx`**

```tsx
"use client"

import { useMemo } from "react"
import { Badge } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaOperator } from "@/lib/agenda-types"
import { buildDaySlots, formatTime, slotIndexForTime, slotSpanForRange } from "@/lib/agenda-time"

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  booked: "neutral",
  confirmed: "warning",
  in_progress: "warning",
  done: "success",
  no_show: "danger",
  cancelled: "danger",
}

export function AgendaGrid({
  day,
  operators,
  appointments,
  onSlotClick,
  onAppointmentClick,
}: {
  day: Date
  operators: AgendaOperator[]
  appointments: AgendaAppointment[]
  onSlotClick: (operatorId: string, slotStartISO: string) => void
  onAppointmentClick: (appointment: AgendaAppointment) => void
}) {
  const slots = useMemo(() => buildDaySlots(), [])

  const appointmentsByOperator = useMemo(() => {
    const map = new Map<string, AgendaAppointment[]>()
    for (const appointment of appointments) {
      if (!appointment.operator_id) continue
      const list = map.get(appointment.operator_id) ?? []
      list.push(appointment)
      map.set(appointment.operator_id, list)
    }
    return map
  }, [appointments])

  if (operators.length === 0) {
    return <p className="agenda-empty-hint">Todavía no hay operadoras asignadas a esta sucursal.</p>
  }

  return (
    <div
      className="agenda-grid"
      style={{ gridTemplateColumns: `72px repeat(${operators.length}, minmax(140px, 1fr))` }}
    >
      <div className="agenda-grid-corner" style={{ gridColumn: 1, gridRow: 1 }} />
      {operators.map((operator, index) => (
        <div key={operator.id} className="agenda-grid-header" style={{ gridColumn: index + 2, gridRow: 1 }}>
          {operator.full_name ?? "Sin nombre"}
        </div>
      ))}

      {slots.map((slot, rowIndex) => (
        <div key={slot.label} className="agenda-grid-time" style={{ gridColumn: 1, gridRow: rowIndex + 2 }}>
          {slot.minute === 0 ? slot.label : ""}
        </div>
      ))}

      {operators.map((operator, colIndex) =>
        slots.map((slot) => {
          const slotStart = new Date(day)
          slotStart.setHours(slot.hour, slot.minute, 0, 0)
          const rowIndex = slots.indexOf(slot)
          return (
            <button
              key={`${operator.id}-${slot.label}`}
              type="button"
              className="agenda-grid-slot"
              style={{ gridColumn: colIndex + 2, gridRow: rowIndex + 2 }}
              onClick={() => onSlotClick(operator.id, slotStart.toISOString())}
              aria-label={`Nuevo turno para ${operator.full_name ?? "operadora"} a las ${slot.label}`}
            />
          )
        })
      )}

      {operators.map((operator, colIndex) =>
        (appointmentsByOperator.get(operator.id) ?? []).map((appointment) => {
          const startRow = slotIndexForTime(appointment.starts_at)
          const span = slotSpanForRange(appointment.starts_at, appointment.ends_at)
          if (startRow < 0 || startRow >= slots.length) return null
          return (
            <button
              key={appointment.id}
              type="button"
              className="agenda-grid-appointment"
              style={{ gridColumn: colIndex + 2, gridRow: `${startRow + 2} / span ${span}` }}
              onClick={() => onAppointmentClick(appointment)}
            >
              <span className="agenda-grid-appointment-time">{formatTime(appointment.starts_at)}</span>
              <span>{appointment.client_name ?? "Sin cliente"}</span>
              <span className="agenda-grid-appointment-services">
                {appointment.services.map((s) => s.name).join(", ")}
              </span>
              <Badge tone={STATUS_TONE[appointment.status] ?? "neutral"}>{appointment.status}</Badge>
            </button>
          )
        })
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/dashboard/agenda/AgendaGrid.tsx
git commit -m "feat(web): AgendaGrid — grilla de horarios por operadora en CSS Grid"
```

---

## Task 7: `NewAppointmentModal` — alta de turno

**Files:**
- Create: `apps/web/app/dashboard/agenda/NewAppointmentModal.tsx`

**Interfaces:**
- Consumes: `Sheet`, `Button`, `Field`, `Input` de `@beautycrm/ui`; `AgendaAppointment`, `AgendaOperator`, `AgendaService` de `@/lib/agenda-types`; `bookAppointment`, `createQuickClient`, `searchClients`, `ClientSearchResult` de `@/lib/agenda-actions`; `rangesOverlap` de `@/lib/agenda-time`.
- Produces: `<NewAppointmentModal open onClose tenantId branchId services operators initialOperatorId initialStartISO dayAppointments>`. Lo consume Task 9.

- [ ] **Step 1: Escribir `apps/web/app/dashboard/agenda/NewAppointmentModal.tsx`**

```tsx
"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaOperator, AgendaService } from "@/lib/agenda-types"
import { bookAppointment, createQuickClient, searchClients, type ClientSearchResult } from "@/lib/agenda-actions"
import { rangesOverlap } from "@/lib/agenda-time"

export function NewAppointmentModal({
  open,
  onClose,
  tenantId,
  branchId,
  services,
  operators,
  initialOperatorId,
  initialStartISO,
  dayAppointments,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  branchId: string
  services: AgendaService[]
  operators: AgendaOperator[]
  initialOperatorId: string
  initialStartISO: string
  dayAppointments: AgendaAppointment[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ClientSearchResult[]>([])
  const [selectedClient, setSelectedClient] = useState<ClientSearchResult | null>(null)
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [quickName, setQuickName] = useState("")
  const [quickPhone, setQuickPhone] = useState("")
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [operatorId, setOperatorId] = useState(initialOperatorId)
  const [startISO, setStartISO] = useState(initialStartISO)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOperatorId(initialOperatorId)
    setStartISO(initialStartISO)
    setQuery("")
    setResults([])
    setSelectedClient(null)
    setShowQuickCreate(false)
    setQuickName("")
    setQuickPhone("")
    setServiceIds([])
    setError(null)
  }, [open, initialOperatorId, initialStartISO])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      const found = await searchClients(tenantId, query)
      setResults(found)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, tenantId])

  const selectedServices = useMemo(
    () => services.filter((s) => serviceIds.includes(s.id)),
    [services, serviceIds]
  )
  const durationMinutes = selectedServices.reduce((sum, s) => sum + s.duration_minutes, 0)
  const totalPreview = selectedServices.reduce((sum, s) => sum + s.price, 0)
  const endISO = useMemo(() => {
    if (!startISO || durationMinutes === 0) return startISO
    return new Date(new Date(startISO).getTime() + durationMinutes * 60_000).toISOString()
  }, [startISO, durationMinutes])

  const overlapWarning = useMemo(() => {
    if (!operatorId || durationMinutes === 0) return false
    return dayAppointments.some(
      (a) =>
        a.operator_id === operatorId &&
        a.status !== "cancelled" &&
        a.status !== "no_show" &&
        rangesOverlap(startISO, endISO, a.starts_at, a.ends_at)
    )
  }, [dayAppointments, operatorId, startISO, endISO, durationMinutes])

  function toggleService(id: string) {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  async function handleQuickCreate() {
    if (!quickName.trim() || !quickPhone.trim()) return
    setLoading(true)
    setError(null)
    const result = await createQuickClient(tenantId, { fullName: quickName, phone: quickPhone })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSelectedClient(result.data)
    setShowQuickCreate(false)
    setQuery("")
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (serviceIds.length === 0) {
      setError("Elegí al menos un servicio.")
      return
    }
    if (overlapWarning) {
      setError("Esa persona ya tiene un turno en ese horario.")
      return
    }

    setLoading(true)
    const result = await bookAppointment({
      branchId,
      clientId: selectedClient?.id ?? null,
      operatorId: operatorId || null,
      startsAt: startISO,
      serviceIds,
    })
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nuevo turno" side="right">
      <form onSubmit={handleSubmit}>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Cliente" htmlFor="agenda-client-search">
          {selectedClient ? (
            <div className="agenda-selected-client">
              <span>
                {selectedClient.full_name}
                {selectedClient.phone ? ` · ${selectedClient.phone}` : ""}
              </span>
              <button type="button" onClick={() => setSelectedClient(null)}>
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <Input
                id="agenda-client-search"
                placeholder="Buscar por nombre o teléfono..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length > 0 ? (
                <ul className="agenda-client-results">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClient(c)
                          setResults([])
                        }}
                      >
                        {c.full_name}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {query.trim().length >= 2 && results.length === 0 ? (
                <button
                  type="button"
                  className="agenda-quick-create-toggle"
                  onClick={() => {
                    setShowQuickCreate(true)
                    setQuickName(query)
                  }}
                >
                  + Crear cliente nuevo
                </button>
              ) : null}
              {showQuickCreate ? (
                <div className="agenda-quick-create">
                  <Field label="Nombre" htmlFor="quick-name">
                    <Input
                      id="quick-name"
                      value={quickName}
                      onChange={(e) => setQuickName(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Teléfono" htmlFor="quick-phone">
                    <Input
                      id="quick-phone"
                      value={quickPhone}
                      onChange={(e) => setQuickPhone(e.target.value)}
                      required
                    />
                  </Field>
                  <Button type="button" variant="secondary" disabled={loading} onClick={handleQuickCreate}>
                    Crear y usar este cliente
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Field>

        <Field label="Servicios" htmlFor="agenda-services">
          <div id="agenda-services" className="agenda-service-list">
            {services.map((s) => (
              <label key={s.id} className="agenda-service-option">
                <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                <span>
                  {s.name} · {s.duration_minutes} min · ${s.price}
                </span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Operadora" htmlFor="agenda-operator">
          <select
            id="agenda-operator"
            className="input"
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
            required
          >
            <option value="">Elegir operadora</option>
            {operators.map((op) => (
              <option key={op.id} value={op.id}>
                {op.full_name ?? "Sin nombre"}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Hora" htmlFor="agenda-start">
          <Input
            id="agenda-start"
            type="datetime-local"
            value={toDatetimeLocal(startISO)}
            onChange={(e) => setStartISO(new Date(e.target.value).toISOString())}
            required
          />
        </Field>

        {durationMinutes > 0 ? (
          <p className="agenda-preview">
            Termina a las {toDatetimeLocal(endISO).slice(11)} · Total ${totalPreview}
          </p>
        ) : null}

        {overlapWarning ? <p className="field-error">Esa persona ya tiene un turno en ese horario.</p> : null}

        <Button type="submit" disabled={loading || overlapWarning} style={{ width: "100%" }}>
          {loading ? "Guardando..." : "Crear turno"}
        </Button>
      </form>
    </Sheet>
  )
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/dashboard/agenda/NewAppointmentModal.tsx
git commit -m "feat(web): NewAppointmentModal — alta de turno con búsqueda/alta rápida de cliente y validación de solapamiento"
```

---

## Task 8: `AppointmentDetailPanel` — detalle y cambio de estado

**Files:**
- Create: `apps/web/app/dashboard/agenda/AppointmentDetailPanel.tsx`

**Interfaces:**
- Consumes: `Badge`, `Button`, `Sheet` de `@beautycrm/ui`; `AgendaAppointment`, `AgendaStatus` de `@/lib/agenda-types`; `updateAppointmentStatus` de `@/lib/agenda-actions`; `formatTime` de `@/lib/agenda-time`.
- Produces: `<AppointmentDetailPanel appointment onClose>`. Lo consume Task 9.

- [ ] **Step 1: Escribir `apps/web/app/dashboard/agenda/AppointmentDetailPanel.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge, Button, Sheet } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaStatus } from "@/lib/agenda-types"
import { updateAppointmentStatus } from "@/lib/agenda-actions"
import { formatTime } from "@/lib/agenda-time"

const NEXT_STATUS: Partial<Record<AgendaStatus, { status: AgendaStatus; label: string }>> = {
  booked: { status: "confirmed", label: "Confirmar" },
  confirmed: { status: "in_progress", label: "Iniciar" },
  in_progress: { status: "done", label: "Completar" },
}

export function AppointmentDetailPanel({
  appointment,
  onClose,
}: {
  appointment: AgendaAppointment | null
  onClose: () => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<AgendaStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!appointment) return null

  async function changeStatus(status: AgendaStatus) {
    setLoading(status)
    setError(null)
    const result = await updateAppointmentStatus(appointment.id, status)
    setLoading(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
    if (status === "done" || status === "cancelled" || status === "no_show") {
      onClose()
    }
  }

  const next = NEXT_STATUS[appointment.status]
  const canCancel = appointment.status !== "done" && appointment.status !== "cancelled"

  return (
    <Sheet open={!!appointment} onClose={onClose} title="Detalle del turno" side="right">
      {error ? <p className="error-banner">{error}</p> : null}

      <p className="agenda-detail-time">
        {formatTime(appointment.starts_at)} – {formatTime(appointment.ends_at)}
      </p>
      <Badge tone="neutral">{appointment.status}</Badge>

      <h3 style={{ marginTop: "var(--space-4)" }}>{appointment.client_name ?? "Sin cliente"}</h3>
      {appointment.client_phone ? <p>{appointment.client_phone}</p> : null}
      <p style={{ color: "var(--color-ink-soft)" }}>{appointment.operator_name ?? "Sin operadora"}</p>

      <ul style={{ paddingLeft: 16 }}>
        {appointment.services.map((s) => (
          <li key={s.service_id}>
            {s.name} · {s.duration_minutes} min · ${s.price_snapshot}
          </li>
        ))}
      </ul>
      <p>
        <strong>Total: ${appointment.total_price}</strong>
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
        {next ? (
          <Button disabled={loading !== null} onClick={() => changeStatus(next.status)}>
            {loading === next.status ? "Guardando..." : next.label}
          </Button>
        ) : null}
        {canCancel ? (
          <>
            <Button variant="secondary" disabled={loading !== null} onClick={() => changeStatus("no_show")}>
              No asistió
            </Button>
            <Button variant="danger" disabled={loading !== null} onClick={() => changeStatus("cancelled")}>
              Cancelar turno
            </Button>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/dashboard/agenda/AppointmentDetailPanel.tsx
git commit -m "feat(web): AppointmentDetailPanel — detalle de turno con transición de estados"
```

---

## Task 9: Ruta `/dashboard/agenda`

**Files:**
- Create: `apps/web/app/dashboard/agenda/AgendaView.tsx`
- Modify: `apps/web/app/dashboard/agenda/page.tsx`
- Modify: `apps/web/components/Sidebar.tsx:28`

**Interfaces:**
- Consumes: `getAgendaAppointments`, `getBranchOperators`, `getActiveServices`, `getDefaultBranch` de `@/lib/agenda-queries`; `startOfWeek`, `addDays`, `formatDayLabel` de `@/lib/agenda-time`; `useAgendaRealtime` de `@/lib/useAgendaRealtime`; `AgendaGrid`, `NewAppointmentModal`, `AppointmentDetailPanel` (Tasks 6-8); `getCurrentMembership` de `@/lib/session`.
- Produces: la ruta `/dashboard/agenda` funcional, reemplazando `ComingSoon`.

- [ ] **Step 1: Escribir `apps/web/app/dashboard/agenda/AgendaView.tsx`**

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarBlank } from "@phosphor-icons/react"
import { EmptyState } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaOperator, AgendaService } from "@/lib/agenda-types"
import { addDays, formatDayLabel } from "@/lib/agenda-time"
import { useAgendaRealtime } from "@/lib/useAgendaRealtime"
import { AgendaGrid } from "./AgendaGrid"
import { NewAppointmentModal } from "./NewAppointmentModal"
import { AppointmentDetailPanel } from "./AppointmentDetailPanel"

const MOBILE_BREAKPOINT_QUERY = "(max-width: 1024px)"

export function AgendaView({
  tenantId,
  branchId,
  weekStartISO,
  initialAppointments,
  operators,
  services,
}: {
  tenantId: string
  branchId: string
  weekStartISO: string
  initialAppointments: AgendaAppointment[]
  operators: AgendaOperator[]
  services: AgendaService[]
}) {
  const router = useRouter()
  const weekStart = useMemo(() => new Date(weekStartISO), [weekStartISO])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const [selectedDay, setSelectedDay] = useState(() => new Date())
  const [modalSlot, setModalSlot] = useState<{ operatorId: string; startISO: string } | null>(null)
  const [detailAppointment, setDetailAppointment] = useState<AgendaAppointment | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileOperatorId, setMobileOperatorId] = useState(operators[0]?.id ?? "")

  useAgendaRealtime(tenantId, () => router.refresh())

  // Vista diaria en mobile/tablet: mismo componente AgendaGrid, pero con
  // una sola columna de operadora (elegida acá) en vez de columnas
  // paralelas — evita reinventar el layout para la pantalla chica.
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
    setIsMobile(mql.matches)
    function handleChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches)
    }
    mql.addEventListener("change", handleChange)
    return () => mql.removeEventListener("change", handleChange)
  }, [])

  const visibleOperators = useMemo(() => {
    if (!isMobile) return operators
    const selected = operators.find((o) => o.id === mobileOperatorId)
    return selected ? [selected] : operators.slice(0, 1)
  }, [isMobile, operators, mobileOperatorId])

  const dayAppointments = useMemo(() => {
    const dayStart = new Date(selectedDay)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = addDays(dayStart, 1)
    return initialAppointments.filter((a) => {
      const t = new Date(a.starts_at)
      return t >= dayStart && t < dayEnd
    })
  }, [initialAppointments, selectedDay])

  if (operators.length === 0) {
    return (
      <div>
        <h1>Agenda</h1>
        <div className="card">
          <EmptyState
            icon={<CalendarBlank size={24} weight="regular" />}
            title="Todavía no hay operadoras"
            description="Invitá a tu equipo desde Configuración para poder cargar turnos."
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1>Agenda</h1>

      <div className="agenda-day-tabs">
        {days.map((day) => (
          <button
            key={day.toISOString()}
            type="button"
            className="agenda-day-tab"
            data-active={day.toDateString() === selectedDay.toDateString()}
            onClick={() => setSelectedDay(day)}
          >
            {formatDayLabel(day)}
          </button>
        ))}
      </div>

      {isMobile && operators.length > 1 ? (
        <select
          className="input"
          style={{ marginBottom: "var(--space-4)" }}
          value={mobileOperatorId}
          onChange={(e) => setMobileOperatorId(e.target.value)}
          aria-label="Elegir operadora"
        >
          {operators.map((op) => (
            <option key={op.id} value={op.id}>
              {op.full_name ?? "Sin nombre"}
            </option>
          ))}
        </select>
      ) : null}

      {initialAppointments.length === 0 ? (
        <div className="card" style={{ marginBottom: "var(--space-4)" }}>
          <EmptyState
            icon={<CalendarBlank size={24} weight="regular" />}
            title="Todavía no hay turnos"
            description="Hacé click en un horario libre de la grilla para cargar el primero."
          />
        </div>
      ) : null}

      <AgendaGrid
        day={selectedDay}
        operators={visibleOperators}
        appointments={dayAppointments}
        onSlotClick={(operatorId, startISO) => setModalSlot({ operatorId, startISO })}
        onAppointmentClick={(appointment) => setDetailAppointment(appointment)}
      />

      {modalSlot ? (
        <NewAppointmentModal
          open={!!modalSlot}
          onClose={() => setModalSlot(null)}
          tenantId={tenantId}
          branchId={branchId}
          services={services}
          operators={operators}
          initialOperatorId={modalSlot.operatorId}
          initialStartISO={modalSlot.startISO}
          dayAppointments={dayAppointments}
        />
      ) : null}

      <AppointmentDetailPanel appointment={detailAppointment} onClose={() => setDetailAppointment(null)} />
    </div>
  )
}
```

- [ ] **Step 2: Reescribir `apps/web/app/dashboard/agenda/page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { CalendarBlank } from "@phosphor-icons/react/dist/ssr"
import { EmptyState } from "@beautycrm/ui"
import { getCurrentMembership } from "@/lib/session"
import {
  getAgendaAppointments,
  getBranchOperators,
  getActiveServices,
  getDefaultBranch,
} from "@/lib/agenda-queries"
import { addDays, startOfWeek } from "@/lib/agenda-time"
import { AgendaView } from "./AgendaView"

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>
}) {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const isMulti = membership.tenants.mode === "multi"
  const params = await searchParams

  let branchId: string | null = null
  if (isMulti) {
    branchId = params.branch ?? membership.branch_id ?? null
  } else {
    const defaultBranch = await getDefaultBranch(membership.tenant_id)
    branchId = defaultBranch?.id ?? null
  }

  if (!branchId) {
    return (
      <div>
        <h1>Agenda</h1>
        <div className="card">
          <EmptyState
            icon={<CalendarBlank size={24} weight="regular" />}
            title="Elegí una sucursal"
            description="Seleccioná una sucursal para ver y cargar turnos."
          />
        </div>
      </div>
    )
  }

  const weekStart = startOfWeek(new Date())
  const weekEnd = addDays(weekStart, 7)

  const [appointments, operators, services] = await Promise.all([
    getAgendaAppointments(membership.tenant_id, weekStart.toISOString(), weekEnd.toISOString(), { branchId }),
    getBranchOperators(membership.tenant_id, branchId),
    getActiveServices(membership.tenant_id),
  ])

  return (
    <AgendaView
      tenantId={membership.tenant_id}
      branchId={branchId}
      weekStartISO={weekStart.toISOString()}
      initialAppointments={appointments}
      operators={operators}
      services={services}
    />
  )
}
```

- [ ] **Step 3: Marcar Agenda como implementada en el sidebar**

En `apps/web/components/Sidebar.tsx`, línea 28, cambiar:

```ts
  { href: "/dashboard/agenda", label: "Agenda", icon: CalendarBlank, implemented: false },
```

por:

```ts
  { href: "/dashboard/agenda", label: "Agenda", icon: CalendarBlank, implemented: true },
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @beautycrm/web build`
Expected: build exitoso, sin errores de tipos.

- [ ] **Step 5: Verificación manual en navegador**

Con `pnpm dev` corriendo y logueado como `joaquin.23.ponce@gmail.com` (tenant `fab8b076-ed53-41c3-bfd6-c581af97fe56`, `mode='single'`):
- Ir a `/dashboard/agenda`. El sidebar ya no debe mostrar "Pronto" en Agenda.
- Debe verse la grilla con la(s) operadora(s) del tenant como columnas y franjas de 08:00 a 21:00.
- Click en una franja vacía abre el modal "Nuevo turno".
- Buscar un cliente existente (hay 2 cargados) y confirmar que aparece en los resultados.
- Elegir un servicio, una operadora, y crear el turno — debe aparecer en la grilla sin recargar la página a mano.
- Click en el turno recién creado abre el panel de detalle con los botones de estado correctos para `booked` (debe ofrecer "Confirmar").

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/dashboard/agenda/AgendaView.tsx apps/web/app/dashboard/agenda/page.tsx apps/web/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
feat(web): activar /dashboard/agenda

Reemplaza el ComingSoon por la vista real: grilla por operadora con
navegación de días, modal de nuevo turno, panel de detalle y realtime.
Se marca Agenda como implementada en el sidebar.
EOF
)"
```

---

## Task 10: Mejoras a "Mi día" (`/o`)

**Files:**
- Create: `apps/web/app/o/MiDiaList.tsx`
- Modify: `apps/web/app/o/page.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `getAgendaAppointments` de `@/lib/agenda-queries`; `updateAppointmentStatus` de `@/lib/agenda-actions`; `useAgendaRealtime` de `@/lib/useAgendaRealtime`; `formatTime` de `@/lib/agenda-time`.
- Produces: `/o` con turnos leídos de `v_agenda`, cards expandibles con botones de estado.

- [ ] **Step 1: Escribir `apps/web/app/o/MiDiaList.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge, Button } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaStatus } from "@/lib/agenda-types"
import { updateAppointmentStatus } from "@/lib/agenda-actions"
import { useAgendaRealtime } from "@/lib/useAgendaRealtime"
import { formatTime } from "@/lib/agenda-time"

const STATUS_LABEL: Record<AgendaStatus, string> = {
  booked: "Reservado",
  confirmed: "Confirmado",
  in_progress: "En curso",
  done: "Hecho",
  no_show: "No vino",
  cancelled: "Cancelado",
}

const NEXT_ACTION: Partial<Record<AgendaStatus, { status: AgendaStatus; label: string }>> = {
  booked: { status: "confirmed", label: "Confirmar" },
  confirmed: { status: "in_progress", label: "Iniciar" },
  in_progress: { status: "done", label: "Completar" },
}

export function MiDiaList({
  tenantId,
  initialAppointments,
}: {
  tenantId: string
  initialAppointments: AgendaAppointment[]
}) {
  const router = useRouter()
  const [appointments, setAppointments] = useState(initialAppointments)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  useAgendaRealtime(tenantId, () => router.refresh())

  async function changeStatus(appointment: AgendaAppointment, status: AgendaStatus) {
    setLoadingId(appointment.id)
    const previous = appointments
    setAppointments((prev) => prev.map((a) => (a.id === appointment.id ? { ...a, status } : a)))

    const result = await updateAppointmentStatus(appointment.id, status)

    setLoadingId(null)
    if (!result.ok) {
      setAppointments(previous)
      return
    }
    router.refresh()
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {appointments.map((a) => {
        const expanded = expandedId === a.id
        const next = NEXT_ACTION[a.status]
        const canMarkNoShow = a.status !== "done" && a.status !== "cancelled" && a.status !== "no_show"

        return (
          <div
            key={a.id}
            className="card card-interactive"
            onClick={() => setExpandedId(expanded ? null : a.id)}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{formatTime(a.starts_at)}</strong>
              <Badge tone={a.status === "done" ? "success" : "neutral"}>{STATUS_LABEL[a.status]}</Badge>
            </div>
            <p style={{ margin: "4px 0 0" }}>{a.client_name ?? "Cliente sin nombre"}</p>
            <p style={{ margin: 0, color: "var(--color-ink-soft)", fontSize: 13 }}>{a.client_phone ?? ""}</p>

            {expanded ? (
              <>
                <ul style={{ paddingLeft: 16, marginTop: 8 }}>
                  {a.services.map((s) => (
                    <li key={s.service_id}>
                      {s.name} · {s.duration_minutes} min
                    </li>
                  ))}
                </ul>
                <div className="agenda-status-actions" onClick={(e) => e.stopPropagation()}>
                  {next ? (
                    <Button disabled={loadingId === a.id} onClick={() => changeStatus(a, next.status)}>
                      {loadingId === a.id ? "Guardando..." : next.label}
                    </Button>
                  ) : null}
                  {canMarkNoShow ? (
                    <Button variant="secondary" disabled={loadingId === a.id} onClick={() => changeStatus(a, "no_show")}>
                      No asistió
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Reescribir `apps/web/app/o/page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { CalendarBlank } from "@phosphor-icons/react/dist/ssr"
import { EmptyState } from "@beautycrm/ui"
import { getCurrentMembership } from "@/lib/session"
import { getAgendaAppointments } from "@/lib/agenda-queries"
import { MiDiaList } from "./MiDiaList"

export default async function MiDiaPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  // RLS ya limita esto a lo suyo si es operator (appointments_select) —
  // filtramos operator_id igual, de forma explícita, para que la query
  // quede clara y acotada.
  const appointments = await getAgendaAppointments(
    membership.tenant_id,
    start.toISOString(),
    end.toISOString(),
    { operatorId: user.id }
  )

  return (
    <div>
      <h1>Mi día</h1>
      <p style={{ color: "var(--color-ink-soft)" }}>
        {now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
      </p>

      {appointments.length === 0 ? (
        <EmptyState
          icon={<CalendarBlank size={24} weight="regular" />}
          title="Sin turnos hoy"
          description="Cuando te asignen un turno para hoy, va a aparecer acá."
        />
      ) : (
        <MiDiaList tenantId={membership.tenant_id} initialAppointments={appointments} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Build**

Run: `pnpm --filter @beautycrm/web build`
Expected: build exitoso.

- [ ] **Step 4: Verificación manual en navegador**

Logueado como una operadora del tenant `fab8b076-...` (si no hay ninguna, se puede invitar una desde `/o` no aplica — usar el flujo de invitación existente o crear una a mano vía SQL para esta verificación):
- Ir a `/o`. Debe ver solo sus propios turnos de hoy.
- Tap en un turno lo expande, mostrando servicios y el botón de acción correspondiente a su estado actual.
- Cambiar de estado actualiza el badge sin recargar la página.
- No debe haber forma de ver turnos de otra operadora.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/o/MiDiaList.tsx apps/web/app/o/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): Mi día lee de v_agenda y suma cambio de estado por turno

Cards expandibles con acciones contextuales (Confirmar/Iniciar/
Completar/No asistió) y optimistic UI. No se toca /o/cliente — el
historial sigue siendo una pantalla separada, a propósito.
EOF
)"
```

---

## Task 11: Test de comportamiento a nivel de datos

**Files:**
- Create: `apps/web/tests/security/agenda-behavior.test.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json` (raíz)

**Interfaces:**
- Consumes: proyecto Supabase real vía `@supabase/supabase-js` (mismo patrón que `tests/security/tenant-isolation.test.ts`).
- Produces: script `pnpm test:agenda` que verifica, a nivel de datos: bloqueo de doble-booking, congelamiento de `price_snapshot`, alta automática en `client_history`, y aislamiento entre operadoras.

- [ ] **Step 1: Escribir `apps/web/tests/security/agenda-behavior.test.ts`**

```ts
/**
 * Invariantes del módulo Agenda que conviene chequear a nivel de datos, no
 * solo de UI: bloqueo de doble-booking, price_snapshot congelado, alta
 * automática en client_history al completar, y aislamiento operadora vs
 * operadora. Mismo patrón que tests/security/tenant-isolation.test.ts:
 * datos 100% descartables contra el proyecto real, borrados en el finally.
 *
 * Ejecutar: pnpm test:agenda (desde apps/web, con .env.local cargado)
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
  const email = `agenda-test-${label}-${Date.now()}@example.com`
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
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Agenda Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    const branchId = tenantRow[0].branch_id

    console.log("Creando operadora, servicio y cliente...")
    const operatorUser = await createTestUser("operator")
    userIds.push(operatorUser.id)
    const operatorClient = await signIn(operatorUser.email, operatorUser.password)

    const { error: membershipError } = await admin.from("memberships").insert({
      tenant_id: tenantId,
      user_id: operatorUser.id,
      branch_id: branchId,
      role: "operator",
    })
    if (membershipError) throw new Error(`No pude crear membership operador: ${membershipError.message}`)

    const { data: service, error: serviceError } = await ownerClient
      .from("services")
      .insert({ tenant_id: tenantId, name: "Manicura", duration_minutes: 60, price: 5000 })
      .select()
      .single()
    if (serviceError || !service) throw new Error(`No pude crear servicio: ${serviceError?.message}`)

    const { data: client, error: clientError } = await ownerClient
      .from("clients")
      .insert({ tenant_id: tenantId, full_name: "Cliente de prueba" })
      .select()
      .single()
    if (clientError || !client) throw new Error(`No pude crear cliente: ${clientError?.message}`)

    // --- Test 1: OPERATOR_BUSY bloquea el doble-booking ---
    console.log("Test 1: doble-booking del mismo operador...")
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const { data: firstBooking, error: firstError } = await operatorClient.rpc("book_appointment", {
      p_branch_id: branchId,
      p_client_id: client.id,
      p_operator_id: operatorUser.id,
      p_starts_at: startsAt,
      p_service_ids: [service.id],
    })
    if (firstError || !firstBooking?.[0]) throw new Error(`Primer turno falló: ${firstError?.message}`)
    const appointmentId = firstBooking[0].appointment_id

    const { error: secondError } = await operatorClient.rpc("book_appointment", {
      p_branch_id: branchId,
      p_client_id: client.id,
      p_operator_id: operatorUser.id,
      p_starts_at: startsAt,
      p_service_ids: [service.id],
    })
    if (!secondError) {
      console.error("  FALLO — se permitió un turno solapado para el mismo operador")
      failures++
    } else if (!secondError.message.includes("OPERATOR_BUSY")) {
      console.error("  FALLO — se bloqueó pero con un error inesperado:", secondError.message)
      failures++
    } else {
      console.log("  OK — bloqueado con OPERATOR_BUSY")
    }

    // --- Test 2: price_snapshot queda congelado ---
    console.log("Test 2: price_snapshot no cambia si el precio del servicio cambia después...")
    await ownerClient.from("services").update({ price: 9999 }).eq("id", service.id)
    const { data: snapshotRow } = await admin
      .from("appointment_services")
      .select("price_snapshot")
      .eq("appointment_id", appointmentId)
      .eq("service_id", service.id)
      .single()
    assert.equal(
      Number(snapshotRow?.price_snapshot),
      5000,
      "FALLO — price_snapshot cambió con el precio del catálogo"
    )
    console.log("  OK — price_snapshot sigue en 5000")

    // --- Test 3: al completar el turno, aparece en client_history ---
    console.log("Test 3: marcar 'done' genera client_history automáticamente...")
    const { error: doneError } = await operatorClient
      .from("appointments")
      .update({ status: "done" })
      .eq("id", appointmentId)
    if (doneError) throw new Error(`No pude marcar el turno como done: ${doneError.message}`)

    const { data: historyRows } = await admin
      .from("client_history")
      .select("id, service_id")
      .eq("appointment_id", appointmentId)
    assert.ok(
      historyRows && historyRows.some((h) => h.service_id === service.id),
      "FALLO — no se generó client_history al completar el turno"
    )
    console.log("  OK — client_history generado")

    // --- Test 4: una operadora no ve turnos de otra en v_agenda ---
    console.log("Test 4: aislamiento entre operadoras...")
    const otherOperator = await createTestUser("operator-b")
    userIds.push(otherOperator.id)
    const otherClient = await signIn(otherOperator.email, otherOperator.password)
    const { error: otherMembershipError } = await admin.from("memberships").insert({
      tenant_id: tenantId,
      user_id: otherOperator.id,
      branch_id: branchId,
      role: "operator",
    })
    if (otherMembershipError) throw new Error(`No pude crear membership B: ${otherMembershipError.message}`)

    const { data: leaked } = await otherClient.from("v_agenda").select("id").eq("id", appointmentId)
    assert.ok(!leaked || leaked.length === 0, "FALLO — la operadora B pudo ver el turno de la operadora A")
    console.log("  OK — 0 filas visibles para la operadora B")
  } finally {
    console.log("Limpiando datos de prueba...")
    if (tenantId) {
      const { data: appts } = await admin.from("appointments").select("id").eq("tenant_id", tenantId)
      const apptIds = (appts ?? []).map((a) => a.id)
      if (apptIds.length > 0) {
        await admin.from("appointment_services").delete().in("appointment_id", apptIds)
        await admin.from("client_history").delete().in("appointment_id", apptIds)
      }
      await admin.from("appointments").delete().eq("tenant_id", tenantId)
      await admin.from("clients").delete().eq("tenant_id", tenantId)
      await admin.from("services").delete().eq("tenant_id", tenantId)
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
    console.error(`\n${failures} test(s) del módulo Agenda FALLARON.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Agenda pasaron.")
}

main().catch((err) => {
  console.error("Error inesperado en el test de Agenda:", err)
  process.exit(1)
})
```

- [ ] **Step 2: Agregar el script en `apps/web/package.json`**

En la sección `"scripts"`, agregar (junto a `"test:security"`):

```json
    "test:agenda": "tsx --env-file=.env.local tests/security/agenda-behavior.test.ts"
```

- [ ] **Step 3: Agregar el script en el `package.json` de la raíz**

Junto a `"test:security": "pnpm --filter @beautycrm/web test:security"`, agregar:

```json
    "test:agenda": "pnpm --filter @beautycrm/web test:agenda"
```

- [ ] **Step 4: Correr el test**

Run: `pnpm test:agenda`
Expected: `Todos los tests de comportamiento de Agenda pasaron.` (exit code 0).

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/security/agenda-behavior.test.ts apps/web/package.json package.json
git commit -m "test(web): invariantes de datos del módulo Agenda (doble-booking, price_snapshot, client_history, aislamiento)"
```

---

## Task 12: E2E Playwright del flujo de turno

**Files:**
- Create: `apps/web/tests/e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: proyecto Supabase real (mismo patrón que `tests/e2e/onboarding.spec.ts`); rutas `/dashboard/agenda` (Task 9).
- Produces: cobertura E2E de "crear turno desde el modal" y "la UI bloquea el doble-booking con mensaje legible" (criterios de aceptación del prompt original).

- [ ] **Step 1: Escribir `apps/web/tests/e2e/agenda.spec.ts`**

```ts
import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Agenda: alta de turno desde el modal y bloqueo de
 * doble-booking visible en la UI. Mismo patrón que onboarding.spec.ts:
 * tenant 100% descartable, provisionado a mano (acá se prueba Agenda, no
 * el wizard de onboarding).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-agenda-owner-${Date.now()}@example.com`
const businessName = `E2E Agenda Salon ${Date.now()}`

let ownerId: string | undefined
let operatorId: string | undefined
let tenantId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
    const { data: appts } = await admin.from("appointments").select("id").eq("tenant_id", tenantId)
    const apptIds = (appts ?? []).map((a) => a.id)
    if (apptIds.length > 0) {
      await admin.from("appointment_services").delete().in("appointment_id", apptIds)
      await admin.from("client_history").delete().in("appointment_id", apptIds)
    }
    await admin.from("appointments").delete().eq("tenant_id", tenantId)
    await admin.from("clients").delete().eq("tenant_id", tenantId)
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

  const { data: operatorData, error: operatorError } = await admin.auth.admin.createUser({
    email: `e2e-agenda-operator-${Date.now()}@example.com`,
    email_confirm: true,
  })
  if (operatorError || !operatorData.user) throw new Error(`No pude crear la operadora: ${operatorError?.message}`)
  operatorId = operatorData.user.id
  await admin.from("users").update({ full_name: "Operadora E2E" }).eq("id", operatorId)

  const { error: membershipError } = await admin.from("memberships").insert({
    tenant_id: tenantId,
    user_id: operatorId,
    branch_id: branchId,
    role: "operator",
  })
  if (membershipError) throw new Error(`No pude crear la membership de la operadora: ${membershipError.message}`)

  const { error: serviceError } = await admin
    .from("services")
    .insert({ tenant_id: tenantId, name: "Manicura E2E", duration_minutes: 60, price: 5000, is_active: true })
  if (serviceError) throw new Error(`No pude crear el servicio: ${serviceError.message}`)
})

test("crear turno desde el modal y bloquear el doble-booking con mensaje legible", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/agenda`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/agenda$/)
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible()

  // --- Turno 1: alta desde el modal ---
  await page.locator(".agenda-grid-slot").first().click()
  await expect(page.getByRole("heading", { name: "Nuevo turno" })).toBeVisible()

  await page.getByPlaceholder("Buscar por nombre o teléfono...").fill("Cliente E2E Agenda")
  await page.getByRole("button", { name: "+ Crear cliente nuevo" }).click()
  await page.getByLabel("Teléfono").fill("+54 9 261 555-1111")
  await page.getByRole("button", { name: "Crear y usar este cliente" }).click()

  await page.locator("#agenda-services").getByText("Manicura E2E").click()
  await page.getByLabel("Operadora").selectOption({ label: "Operadora E2E" })

  const conflictingTime = await page.getByLabel("Hora").inputValue()

  await page.getByRole("button", { name: "Crear turno" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo turno" })).toBeHidden()
  await expect(page.getByText("Cliente E2E Agenda")).toBeVisible()

  // --- Turno 2: mismo horario, misma operadora → bloqueado en la UI ---
  await page.locator(".agenda-grid-slot").last().click()
  await expect(page.getByRole("heading", { name: "Nuevo turno" })).toBeVisible()

  await page.getByPlaceholder("Buscar por nombre o teléfono...").fill("Cliente E2E Agenda")
  await page.getByRole("button", { name: /Cliente E2E Agenda/ }).click()
  await page.locator("#agenda-services").getByText("Manicura E2E").click()
  await page.getByLabel("Operadora").selectOption({ label: "Operadora E2E" })
  await page.getByLabel("Hora").fill(conflictingTime)

  await expect(page.getByText("Esa persona ya tiene un turno en ese horario.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Crear turno" })).toBeDisabled()
})
```

- [ ] **Step 2: Correr el test E2E**

Run: `pnpm --filter @beautycrm/web test:e2e -- tests/e2e/agenda.spec.ts`
Expected: 1 test pasa. Si algún selector no matchea (los textos exactos de botones/placeholders pueden variar levemente según lo que terminó implementado en las Tasks 7/9), ajustar el selector correspondiente en el spec — no el componente — y volver a correr.

- [ ] **Step 3: Correr la suite E2E completa (regresión)**

Run: `pnpm --filter @beautycrm/web test:e2e`
Expected: `onboarding.spec.ts` y `agenda.spec.ts` pasan ambos.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e/agenda.spec.ts
git commit -m "test(web): E2E de Agenda — alta de turno y bloqueo de doble-booking en la UI"
```

---

## Task 13: Verificación final y checklist manual

**Files:** ninguno nuevo — solo comandos y verificación.

**Interfaces:** N/A (tarea de cierre).

- [ ] **Step 1: Build completo**

Run: `pnpm --filter @beautycrm/web build`
Expected: exitoso.

- [ ] **Step 2: Lint**

Run: `pnpm --filter @beautycrm/web lint`
Expected: sin errores (warnings preexistentes no relacionados a Agenda son aceptables, pero nada nuevo introducido por este trabajo).

- [ ] **Step 3: Suite completa de tests**

Run: `pnpm test:security && pnpm test:agenda && pnpm --filter @beautycrm/web test:e2e`
Expected: todo en verde.

- [ ] **Step 4: Checklist manual contra el tenant real**

Con `pnpm dev` corriendo, logueado como `joaquin.23.ponce@gmail.com` en el tenant `fab8b076-ed53-41c3-bfd6-c581af97fe56` (`mode='single'`), repasar los criterios de aceptación del prompt original uno por uno:

- [ ] No se puede crear un turno superpuesto para el mismo operador (probar en `/dashboard/agenda`, ver el mensaje `OPERATOR_BUSY` legible).
- [ ] El precio de un turno queda congelado aunque se cambie el precio del servicio después (crear turno, cambiar precio en un futuro módulo Servicios o vía SQL, confirmar en el panel de detalle que el precio no cambió).
- [ ] Al marcar un turno como `done` desde `/o` o desde el panel de detalle, aparece en el historial del cliente (verificar con `select * from client_history where appointment_id = '<id>'` vía Supabase, no hay UI de historial en este módulo).
- [ ] Una operadora solo ve y agenda sus propios turnos en `/o`; el dueño ve todos en `/dashboard/agenda`.
- [ ] El calendario se actualiza en tiempo real: abrir `/dashboard/agenda` en dos pestañas, crear un turno en una, confirmar que aparece en la otra sin recargar a mano.
- [ ] Con `mode='single'` (el caso real de este tenant) no se muestra selector de sucursal — confirmar que el header de `/dashboard` sigue igual que antes.

- [ ] **Step 5: Confirmar el estado de git**

Run: `git log --oneline -15 && git status`
Expected: 12 commits nuevos de las Tasks 1-12, working tree limpio.

No hay Step de commit en esta tarea — es solo verificación; si algo falla, corregir en la task correspondiente y volver a este checklist.

---

## Fuera de alcance (recordatorio)

- Módulo Clientes completo, integración Google Calendar, horario configurable por tenant, resolución del tenant duplicado, recordatorios WhatsApp — todos explícitamente fuera de alcance según el spec (`docs/superpowers/specs/2026-08-10-agenda-module-design.md`, sección "Fuera de alcance").
