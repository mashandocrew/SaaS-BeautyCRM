# Módulo Clientes — Diseño (frontend)

Fecha: 2026-08-12
Estado: Aprobado por el usuario, listo para plan de implementación.

## Contexto

BeautyCRM es un SaaS multi-tenant para salones de belleza. El módulo **Agenda** ya está en producción (`main`, migraciones `0007`/`0008`): genera automáticamente una fila en `client_history` por cada servicio completado (trigger `on_appointment_completed`). El sidebar del dashboard tiene un link a `/dashboard/clientes` marcado "Pronto" (`Sidebar.tsx`, `implemented: false`). Este documento cubre el frontend de ese módulo — el modelo de datos (`clients`, `client_history`) ya existe desde `migrations/0001_initial_schema.sql`, no se recrea.

Rol: exclusivamente Dueño/Supervisor. `/dashboard/*` ya redirige operadoras a `/o` (`dashboard/layout.tsx`), este módulo no las toca.

## Tenant de prueba

Mismo criterio que Agenda: usar tenants descartables provisionados vía admin API para desarrollo/pruebas (mismo patrón que `tests/e2e/agenda.spec.ts` y la verificación manual de la Task 13 de Agenda), no el tenant real de producción (`fab8b076-ed53-41c3-bfd6-c581af97fe56`).

## Modelo de datos (ya aplicado, no se recrea)

```sql
clients (
  id uuid PK, tenant_id uuid FK,
  full_name text, phone text, email text, birthday date, notes text,
  created_at timestamptz
)

client_history (
  id uuid PK, tenant_id uuid FK,
  client_id uuid FK, appointment_id uuid FK NULL, service_id uuid FK NULL,
  operator_id uuid FK NULL, branch_id uuid FK NULL,
  performed_at timestamptz,
  technical_notes text NULL,     -- "tono 7.3, sensibilidad en cutícula"
  photos jsonb                    -- fuera de alcance esta vuelta, ver abajo
)
```

`client_history` es insert-only vía el trigger de Agenda — una fila por *servicio* realizado, no por turno (un turno con 2 servicios genera 2 filas).

**Dato real detectado en el código existente:** `apps/web/app/o/cliente/actions.ts` (`addTechnicalNote`, ya en producción) deja que la operadora agregue una nota desde su PWA — pero lo hace **insertando una fila nueva** en `client_history` con `service_id: null`, atada al mismo `appointment_id`, no editando una fila existente. Es un flujo distinto y complementario al de este módulo (operadora agrega una nota rápida sobre el próximo turno; dueño/supervisor edita una nota ya cargada desde la ficha) — no se toca `/o/cliente` en este trabajo. Pero sí implica que `v_client_history`/`ClientHistoryTable` van a encontrar filas reales con `service_name: null` (notas sueltas sin servicio asociado): la tabla las muestra con la etiqueta "Nota" en vez de una celda de servicio vacía.

## Gap detectado: falta policy de UPDATE en `client_history`

Las policies de `0001_initial_schema.sql` cubren `clients` completo (`select`/`insert`/`update` para cualquier miembro del tenant, `delete` solo owner/supervisor) pero `client_history` solo tiene `select` e `insert` — **no existe policy de `update`**. Sin ella, no se puede persistir una nota técnica desde ningún lado. Hace falta una migración nueva.

## Migración nueva: `migrations/0009_client_history_module.sql`

```sql
-- Permite editar client_history — hoy solo se puede insertar (vía trigger).
-- Restringido a owner/supervisor: mismo criterio que clients_delete, y este
-- módulo entero vive bajo /dashboard (owner/supervisor-only por layout.tsx).
-- OJO: esta policy controla QUÉ FILAS se pueden tocar, no qué columnas —
-- la barrera de "solo se edita technical_notes" es de la Server Action
-- (updateHistoryNotes hace .update({ technical_notes }) explícito, nunca
-- un update genérico), no de RLS.
create policy client_history_update on public.client_history for update
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));

-- v_client_history: lectura resuelta para la ficha del cliente, mismo
-- criterio que v_agenda (Agenda, migración 0007) — evita reconstruir joins
-- a mano en cada lectura. security_invoker=true: respeta las RLS de
-- client_history/services/users/branches, no las bypassea.
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

## Rutas y flujo de datos

```
/dashboard/clientes             → lista + búsqueda instantánea + botón "Nuevo cliente"
/dashboard/clientes/[id]        → ficha: datos, resumen de visitas, historial, editar/eliminar
```

**Lecturas** (Server Components):
- `getClients(tenantId)` — todos los clientes del tenant, ordenados por nombre. Sin paginación server-side: el filtro es instantáneo en cliente (mismo patrón que `MiDiaList` de Agenda), consistente con la escala actual. Paginar es un cambio aislado a esta función si algún tenant crece mucho — no se resuelve ahora.
- `getClientDetail(tenantId, clientId)` — cliente + su historial vía `v_client_history` (ordenado por `performed_at desc`) + resumen calculado: **visitas** = cantidad de `appointment_id` **distintos** en el historial (no filas crudas — una fila es un servicio, no una visita), **última visita** = `max(performed_at)`. Si el cliente no existe o no pertenece al tenant, RLS ya lo filtra fuera → 404 (`notFound()`).

**Mutaciones** (Server Actions, patrón `ActionResult<T>` establecido en `lib/agenda-actions.ts`):
- `createClient`, `updateClient`, `deleteClient` en `lib/client-actions.ts` (archivo nuevo).
- `updateHistoryNotes(historyId, notes)` — solo toca `technical_notes`.

**No se toca `agenda-actions.ts`**: `createQuickClient` (alta mínima nombre+teléfono desde el modal de turno) se queda como está — es un flujo distinto y ya está en producción y probado; no hay beneficio en tocarlo para este módulo.

## Dato real: borrar un cliente con historial falla por FK, y eso es correcto

`client_history.client_id`, `appointments.client_id` y `sales.client_id` referencian `clients(id)` sin `ON DELETE CASCADE` (`migrations/0001_initial_schema.sql`). Borrar un cliente que ya tiene turnos/historial/ventas asociados dispara un `foreign_key_violation` (`23503`) de Postgres, no un borrado silencioso. Esto es el comportamiento correcto — el pedido original de "Eliminar cliente" era para limpiar altas duplicadas o de prueba, no para clientes con historial real, y bloquear ahí protege datos reales de un borrado accidental. `deleteClient` mapea `error.code === "23503"` a un mensaje legible ("No se puede eliminar: esta persona tiene turnos o historial asociado.") en vez de dejar pasar el error crudo de Postgres.

## Componentes y archivos

Reutiliza el design system tal cual (`Card`, `Badge`, `EmptyState`, `Sheet`, `Field`/`Input`, `StatTile`, y la spec de Tabla ya documentada en `docs/ui-design-system.md` sección 9) — sin CSS nuevo más allá de clases puntuales si hace falta.

```
apps/web/lib/client-types.ts        — ClientRecord, ClientHistoryEntry, ClientDetail
apps/web/lib/client-queries.ts      — getClients(tenantId), getClientDetail(tenantId, clientId)
apps/web/lib/client-actions.ts      — createClient, updateClient, deleteClient, updateHistoryNotes

apps/web/app/dashboard/clientes/page.tsx            — Server Component: getClients → ClientesList
apps/web/app/dashboard/clientes/ClientesList.tsx     — Client Component: input de búsqueda (filtro en memoria por nombre/teléfono), tabla, botón "Nuevo cliente" → ClientFormSheet modo alta

apps/web/app/dashboard/clientes/[id]/page.tsx            — Server Component: getClientDetail → ClientDetailView, notFound() si no existe
apps/web/app/dashboard/clientes/[id]/ClientDetailView.tsx — Client Component: header (nombre/teléfono/email/cumpleaños), StatTile x2 (visitas, última visita), Editar (ClientFormSheet modo edit) / Eliminar (confirm nativo)
apps/web/app/dashboard/clientes/[id]/ClientHistoryTable.tsx — tabla de historial: fecha, servicio, operadora, nota técnica editable inline (textarea + botón Guardar por fila)

apps/web/app/dashboard/clientes/ClientFormSheet.tsx — Sheet reutilizable alta/edición (prop mode: "create" | "edit"), campos: nombre* / teléfono / email / cumpleaños / notas
```

`components/Sidebar.tsx`: `implemented: false → true` en el ítem de Clientes.

Sin realtime en este módulo — a diferencia de Agenda, no hace falta reflejar cambios de otra pestaña al instante; `router.refresh()` tras crear/editar/eliminar alcanza.

## Fuera de alcance (confirmado con el usuario)

- Fotos antes/después (`client_history.photos`, requiere Supabase Storage) — solo notas de texto esta vuelta.
- Paginación del listado — instant-filter en memoria alcanza a la escala actual.
- Segmentación/etiquetado de clientes (VIP, etc.) — no pedido.
- Total gastado por cliente en el resumen — `price_snapshot` vive en `appointment_services`, no en `client_history`; requeriría un join adicional no pedido en esta vuelta.

## Testing

- `tests/security/clientes-behavior.test.ts` (tenant descartable, cleanup en `afterAll`, mismo patrón que `agenda-behavior.test.ts`):
  1. Operador no puede borrar un cliente (RLS bloquea `clients_delete`).
  2. Dueño sí puede.
  3. Operador no puede editar `technical_notes` (RLS bloquea `client_history_update`).
  4. Dueño sí puede.
  - Aislamiento cross-tenant de `clients` ya cubierto por `tests/security/tenant-isolation.test.ts` — no se repite.
- `tests/e2e/clientes.spec.ts` (Playwright): alta de cliente desde `/dashboard/clientes` → aparece en el listado → entrar a la ficha → editar nota técnica de una visita → persiste tras refrescar.

## Revisión del sistema de diseño (nota de esta sesión)

Antes de este módulo se re-evaluó `docs/ui-design-system.md` contra las skills `minimalist-ui`, `frontend-design` y `high-end-visual-design`. Resultado: el sistema ya está bien alineado con `minimalist-ui` y con la guía de escritura de `frontend-design` (voz activa, empty states como invitación a actuar). Se corrigieron dos gaps reales — convención de peso Phosphor por tamaño (sección 7) y accesibilidad nombrada como principio (sección 1) — ya commiteados (`docs: aclara convención de peso Phosphor y nombra accesibilidad como principio`). `high-end-visual-design` se evalúa y se descarta explícitamente para este dashboard: su dirección (glass, motion agresivo, `py-24`+) contradice los dials ya aprobados (motion 4/10, densidad funcional). Este módulo sigue el sistema sin cambios adicionales.
