# Módulo Agenda — Diseño (frontend)

Fecha: 2026-08-10
Estado: Aprobado por el usuario, listo para plan de implementación.

## Contexto

BeautyCRM es un SaaS multi-tenant para salones de belleza. El dashboard (`/dashboard`) y la PWA de operadora (`/o`) ya existen; el módulo **Agenda** figura como "Pronto" en el sidebar y es el siguiente a implementar, según la arquitectura "amoldable" (mono-sede ↔ multi-sucursal) de `docs/arquitectura-saas-salones.md` (Bloque A.3).

El backend ya está aplicado en Supabase (proyecto `xhbrhpfzehshiyjzlxnx`, región `sa-east-1`), migraciones `0007_agenda_module` y `0008_agenda_advisor_fixes`. Este documento cubre **solo el frontend Next.js** (`apps/web`).

Roles y vistas (ya definidos en la arquitectura, no se redefinen acá):
- **Dueño/Supervisor**: desktop-first. Calendario semanal/diario con selector de sucursal (oculto si `tenants.mode = 'single'`).
- **Operadora**: 100% mobile PWA, tres pantallas fijas (`Mi día`, `Mi cliente`, `Mis comisiones`). Este módulo toca solo `Mi día`.

## Tenant de prueba

Hay dos tenants "Jacintas Nails" en la base:
- `43e3325f-9c96-4a0f-8383-c3c190bff0ca` (07/07/2026): 0 memberships, 3 commission_rules seed. **No usable para probar** — nadie puede loguearse ahí.
- `fab8b076-ed53-41c3-bfd6-c581af97fe56` (10/08/2026): membership `owner` de `joaquin.23.ponce@gmail.com`, 1 branch, 6 services, 2 clients, 2 appointments, 3 commission_rules.

**Usar `fab8b076-ed53-41c3-bfd6-c581af97fe56` para todo el desarrollo y las pruebas manuales/E2E.** No se toca la existencia de ninguno de los dos tenants como parte de este trabajo — es una decisión de datos que el usuario dejó pendiente y explícitamente fuera de este alcance.

## Modelo de datos (ya aplicado, no se recrea)

```sql
appointments (
  id uuid PK, tenant_id uuid, branch_id uuid,
  client_id uuid NULL, operator_id uuid NULL,
  starts_at timestamptz, ends_at timestamptz,
  status enum('booked','confirmed','in_progress','done','no_show','cancelled'),
  google_event_id text NULL,
  source enum('internal','google','online_booking'),
  created_at timestamptz
)

appointment_services (
  appointment_id uuid, service_id uuid,
  price_snapshot numeric        -- precio congelado al momento de reservar
)
```

Constraint `appointments_no_overlap` (EXCLUDE USING gist sobre `tenant_id`, `operator_id`, rango `[starts_at, ends_at)`) impide turnos superpuestos para el mismo operador salvo `cancelled`/`no_show`. Es la barrera de verdad (`SQLSTATE 23P01`); la UI valida además para dar feedback inmediato, pero **nunca es la única barrera**.

## Gap detectado: sincronización de esquema/migraciones

- `packages/supabase/src/types.ts` ya incluye `appointments`, `appointment_services`, `client_history`, `services` y los enums `appointment_status`/`appointment_source` — pero **no** incluye la vista `v_agenda` ni la función `book_appointment`. Hay que regenerar los tipos contra el proyecto remoto (`generate_typescript_types`) antes de escribir código que los use.
- `migrations/` en este repo llega hasta `0006_realtime_commission_ledger.sql`. Las migraciones `0007_agenda_module` y `0008_agenda_advisor_fixes` están aplicadas en Supabase pero no versionadas en el repo. Hay que traerlas (`list_migrations` + volcar el SQL aplicado) y agregarlas como archivos `migrations/0007_agenda_module.sql` y `migrations/0008_agenda_advisor_fixes.sql` para que el historial quede completo — sin volver a aplicarlas (`apply_migration` es idempotente por nombre, pero de todas formas no se re-ejecuta nada, solo se documenta lo ya aplicado).

## API a usar desde el frontend

### 1. Crear un turno → RPC `book_appointment` (no INSERT directo)

```ts
const { data, error } = await supabase.rpc('book_appointment', {
  p_branch_id: branchId,
  p_client_id: clientId,       // puede ser null (venta de mostrador futura)
  p_operator_id: operatorId,   // null si aún no se asigna operador
  p_starts_at: isoStartTimestamp,
  p_service_ids: [serviceId1, serviceId2],
  p_source: 'internal',
});
```

Calcula `ends_at`, congela `price_snapshot`, valida operador/tenant y permisos de quién reserva. Devuelve `{ appointment_id, starts_at, ends_at }`.

Mapeo de errores a español (`lib/agenda-errors.ts`, tabla compartida por modal y cualquier otro punto de entrada):
- `OPERATOR_BUSY` → "Esa persona ya tiene un turno en ese horario."
- `INVALID_SERVICE_SELECTION` → "Uno de los servicios elegidos no existe o está inactivo."
- `NOT_ALLOWED_TO_BOOK_FOR_THIS_OPERATOR` → "No podés agendar turnos para otra persona."
- `BRANCH_NOT_FOUND` / `NOT_A_MEMBER` → error genérico de configuración.
- Cualquier otro código → mensaje genérico ("No se pudo crear el turno. Probá de nuevo.").

### 2. Leer turnos → vista `v_agenda` (no reconstruir joins a mano)

```ts
const { data } = await supabase
  .from('v_agenda')
  .select('*')
  .gte('starts_at', rangeStart)
  .lt('starts_at', rangeEnd)
  .eq('branch_id', branchId)       // omitido si mode='single'
  .order('starts_at');
```

Cada fila trae `client_name`, `operator_name`, `services` (jsonb array) y `total_price`. Respeta RLS (`security_invoker`): operadora ve solo lo suyo, dueño/supervisor ven todo el tenant. En "Mi día" se filtra además `operator_id = session.user.id` de forma explícita (RLS ya lo garantiza, pero deja la query clara y acotada).

### 3. Cambiar estado de un turno

```ts
await supabase.from('appointments').update({ status: 'in_progress' }).eq('id', appointmentId);
```

Transiciones: `booked → confirmed → in_progress → done`, con salidas laterales a `no_show`/`cancelled` desde cualquier estado previo a `done`. El trigger `on_appointment_completed` inserta automáticamente en `client_history` al llegar a `done` — **no se duplica esa lógica en el cliente**.

### 4. Tiempo real

`appointments` ya está en `supabase_realtime`. Un hook compartido se suscribe y dispara refresco:

```ts
supabase
  .channel('agenda-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => refetchAgenda())
  .subscribe();
```

## Arquitectura del frontend

### Rutas y archivos

- `app/dashboard/agenda/page.tsx` — reemplaza el `ComingSoon` actual. Server Component que resuelve `tenant`, `mode`, `branchId` (de query param si `multi`) y pasa datos iniciales a un client component.
- `app/dashboard/agenda/AgendaGrid.tsx` (client) — grilla semanal/diaria.
- `app/dashboard/agenda/NewAppointmentModal.tsx` (client) — alta de turno.
- `app/dashboard/agenda/AppointmentDetailPanel.tsx` (client) — detalle + cambio de estado.
- `app/dashboard/agenda/agenda-actions.ts` — server actions: `bookAppointment`, `updateAppointmentStatus`, `searchClients`, `createQuickClient`.
- `app/dashboard/agenda/agenda-queries.ts` — lectura server-side de `v_agenda`, servicios activos, operadoras de la sucursal.
- `app/o/page.tsx` — se extiende in-place (no se crea ruta nueva `/mi-dia`): pasa a leer de `v_agenda`, cards expandibles con botones de estado.
- `app/o/agenda-status-actions.ts` — server action compartida con la vista de dueño para `updateAppointmentStatus` (misma función, dos consumidores).
- `lib/agenda-errors.ts` — mapa de errores del RPC.
- `lib/useAgendaRealtime.ts` — hook client-side de suscripción realtime.
- `packages/ui/src/components/Sheet.tsx` — panel modal genérico (drawer en desktop, bottom-sheet en mobile vía CSS, sin dependencias nuevas). Se usa para el modal de nuevo turno y el panel de detalle.
- `packages/ui/src/components/Combobox.tsx` — buscador simple (input + lista filtrada) para cliente/servicios/operadora en el modal. Sin librería externa.

### Vista Dueño/Supervisor (`/dashboard/agenda`)

- **Grid semanal (≥1024px):** CSS Grid, columnas = operadoras de la sucursal activa (o de todo el tenant en `single`), filas = franjas de 30 min entre `08:00` y `21:00` (rango fijo por ahora; no existe todavía horario configurable en `tenants.settings`). Cada turno ocupa el rango de filas correspondiente a `ends_at - starts_at`, no una celda fija. Header con navegación semana anterior/siguiente.
- **Vista diaria (<1024px):** mismo componente `AgendaGrid` con un dropdown de operadora arriba que fuerza una sola columna — reusa el mismo layout, no es un componente distinto.
- **Selector de sucursal:** oculto si `mode='single'` (ya resuelto en `layout.tsx`). Si `mode='multi'`, dropdown en el header que escribe `?branch=<id>` en la URL (persistente sin infraestructura de sesión nueva). Dado que el tenant real está en `single`, este camino no es testeable con datos reales hoy — se implementa y se deja documentado como no verificado end-to-end contra datos reales.
- **Click en franja vacía → `NewAppointmentModal`:**
  - Combobox de cliente (busca en `clients` por nombre/teléfono, debounced) + "Crear cliente nuevo" inline (nombre + teléfono) si no aparece — incluso patrón que el Paso 3 del onboarding.
  - Multi-select de servicios activos (con duración/precio de catálogo, total en vivo de preview; el servidor recalcula con `price_snapshot`).
  - Selector de operadora (membresías `operator` de la sucursal).
  - Hora pre-cargada de la franja clickeada, editable.
  - Validación client-side de solapamiento contra los turnos ya cargados en el grid (misma operadora, mismo rango) antes de habilitar submit — deshabilita el botón con el mensaje de `OPERATOR_BUSY`. No reemplaza el `EXCLUDE` constraint.
  - Submit → `book_appointment`. Error → mensaje mapeado, inline, modal no se cierra.
- **Click en turno existente → `AppointmentDetailPanel`:** cliente, servicios, precio total, operadora, horario. Botones de transición de estado + "Cancelar". `update` directo a `appointments.status` (no hay RPC dedicada para esto, igual que el resto del código ya hace con otras tablas).
- **Estado vacío:** mismo tono que el resto del dashboard ("Todavía no hay turnos → Cargar el primero"), usando `EmptyState` existente.

### Vista Operadora (`/o`)

- Migra la query de `appointments` directo a `v_agenda`, filtrando explícitamente `operator_id = session.user.id`.
- Cada card es expandible (tap): muestra servicios del turno + botones de estado contextuales al estado actual (`Confirmar` si `booked`, `Iniciar` si `confirmed`, `Completar` si `in_progress`, `No asistió` disponible en cualquier estado previo a `done`). Turno `done` no ofrece acciones.
- No se tocan `/o/cliente` ni `/o/comisiones` — el historial/notas técnicas sigue viviendo solo en "Mi cliente", a propósito, para no romper el patrón de "tres pantallas y nada más" del Bloque A.3.
- Optimistic UI en el cambio de estado (la card cambia antes de la respuesta del server, rollback si falla).

### Tiempo real

- `lib/useAgendaRealtime.ts`: hook client-side que se suscribe a `postgres_changes` en `appointments` filtrado por `tenant_id` y llama `router.refresh()`. Se usa en `/dashboard/agenda` y en `/o`. No se mantiene estado duplicado en cliente — server components vuelven a pedir datos frescos, consistente con el resto del dashboard.

### Manejo de errores

- `lib/agenda-errors.ts` centraliza el mapa de códigos → mensaje en español (ver tabla arriba). Se usa desde `NewAppointmentModal` y cualquier otro punto que llame `book_appointment`.

## Criterios de aceptación (del pedido original)

- [ ] No se puede crear un turno superpuesto para el mismo operador (UI + `OPERATOR_BUSY` legible).
- [ ] `price_snapshot` queda congelado aunque cambie el precio del servicio después.
- [ ] Al marcar `done`, aparece en `client_history` automáticamente (vía trigger, no insertado desde el frontend).
- [ ] Una operadora solo ve/agenda sus propios turnos; dueño/supervisor ven todo el tenant.
- [ ] El calendario se actualiza en tiempo real si otro usuario crea/edita un turno (dos pestañas).
- [ ] En `mode='single'` no se muestra selector de sucursal; en `multi` sí (implementado, no verificable end-to-end con datos reales de este tenant).

## Plan de pruebas

- Playwright E2E (`apps/web/playwright.config.ts` ya existe) contra el tenant `fab8b076-ed53-41c3-bfd6-c581af97fe56`:
  - Crear turno exitoso desde el modal.
  - Doble-booking bloqueado, mensaje `OPERATOR_BUSY` visible.
  - `price_snapshot` no cambia al editar el precio del servicio después de creado el turno.
  - Turno marcado `done` aparece en `client_history` (verificado por query, no por UI que no existe para eso).
  - Operadora no ve turnos de otra operadora; dueño ve todos.
  - Realtime: crear turno en una pestaña, verificar que aparece en otra sin recargar manualmente.
- `pnpm build` y `pnpm lint` al final (patrón ya usado en el repo).

## Fuera de alcance de este módulo

- Módulo Clientes completo (alta inline en el modal cubre el mínimo necesario, no reemplaza una pantalla de gestión de clientes).
- Integración Google Calendar (`google_event_id` ya existe en el modelo, sync no se implementa acá).
- Horario de atención configurable por tenant (rango fijo `08:00–21:00` por ahora).
- Resolución del tenant duplicado (decisión de datos pendiente del usuario, no se toca).
- Recordatorios por WhatsApp.
