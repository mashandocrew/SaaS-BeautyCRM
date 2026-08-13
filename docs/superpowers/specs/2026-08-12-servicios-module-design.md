# Módulo Servicios — Diseño (frontend)

Fecha: 2026-08-12
Estado: Implementado y en `main`.

> **Actualización 2026-08-13 — el borrado cambió.** Este documento diseñó
> `deleteService` como un `DELETE` real que falla con `23503` cuando el
> servicio ya fue usado, y presentó `is_active` como el mecanismo cotidiano
> para sacar un servicio de circulación. Eso **ya no es así**:
> `migrations/0011_service_soft_delete.sql` convirtió el borrado en suave
> (`services.deleted_at` + `app.soft_delete_service`), así que eliminar
> siempre funciona y el servicio desaparece del catálogo sin romper el
> historial. Los párrafos marcados abajo quedaron obsoletos; la razón del
> cambio está en el encabezado de esa migración.

## Contexto

BeautyCRM es un SaaS multi-tenant para salones de belleza. Agenda y Clientes ya están en producción (`main`). El sidebar tiene un link a `/dashboard/servicios` marcado "Pronto" (`Sidebar.tsx`, `implemented: false`). Este documento cubre el frontend de ese módulo — el modelo de datos (`services`) ya existe desde `migrations/0001_initial_schema.sql`, no se recrea.

Rol: Dueño y Supervisor pueden crear/editar servicios. Solo Dueño puede borrarlos (ver RLS abajo — más estricto que Clientes). `/dashboard/*` ya redirige operadoras a `/o` (`dashboard/layout.tsx`), este módulo no las toca.

Hoy `services` ya lo consumen dos módulos en producción:
- Agenda: `getActiveServices(tenantId)` en `lib/agenda-queries.ts`, usado por `NewAppointmentModal` — solo lee `is_active = true`.
- Clientes: `client_history.service_id` se resuelve a `service_name` vía `v_client_history` para mostrar qué servicio se hizo en cada visita.

Ninguno de los dos se toca en este trabajo — solo se agrega la UI de gestión que falta.

## Tenant de prueba

Mismo criterio que Agenda y Clientes: tenants descartables provisionados vía admin API, nunca el tenant real de producción.

## Modelo de datos y RLS (ya aplicados, no se recrean — sin migración nueva)

```sql
services (
  id uuid PK, tenant_id uuid FK,
  name text, duration_minutes int, price numeric,
  category text NULL, is_active boolean
)
```

Policies (`migrations/0001_initial_schema.sql`):
- `services_select`: cualquier miembro del tenant (necesario para que una operadora vea el catálogo al reservar en Agenda).
- `services_insert` / `services_update`: owner o supervisor.
- `services_delete`: **owner únicamente** — más estricto que `clients_delete` (owner o supervisor). No hay razón documentada para la diferencia, pero no se toca acá; el frontend sigue lo que dice la policy.

**Verificado en la base real (Supabase MCP, `pg_constraint`) antes de diseñar**, dado que el módulo Clientes encontró drift real entre las migraciones versionadas y el schema en vivo: `appointment_services_service_id_fkey` y `client_history_service_id_fkey` son ambas `NO ACTION` (`confdeltype = 'a'`) en producción, sin drift. Borrar un servicio con historial de uso (turnos ya facturados con ese servicio, o historial de cliente que lo referencia) falla limpio con `foreign_key_violation` (`23503`) — mismo comportamiento que ya construimos para `deleteClient` en el módulo Clientes.

~~**Por qué `is_active` es el mecanismo real de "borrado":** dado que borrar un servicio con historial va a fallar la gran mayoría de las veces (cualquier servicio usado alguna vez en un turno), la acción cotidiana para "sacar un servicio de circulación" es desactivarlo (`is_active = false`), no borrarlo. Al desactivarse, deja de aparecer en `getActiveServices` (Agenda) pero el historial que ya lo referencia sigue intacto. Borrado real (`deleteService`) solo tiene efecto para servicios que nunca se usaron.~~

**Obsoleto desde `0011`.** Hoy eliminar funciona siempre, para cualquier servicio, y es lo que hace desaparecer al servicio del catálogo. `is_active` quedó con el rol más chico que le corresponde: sacarlo de circulación **sin** sacarlo de la lista — el servicio sigue visible con su badge "Inactivo" y se puede reactivar de un clic. Las FK descritas arriba siguen siendo `NO ACTION` y siguen siendo la razón por la que el borrado tiene que ser suave: el `price_snapshot` del turno y el nombre que `v_client_history` resuelve por join dependen de que la fila siga existiendo.

## Rutas y flujo de datos

Todo en `/dashboard/servicios` — sin ruta de detalle por servicio (a diferencia de Clientes): un servicio no tiene historial propio que amerite una ficha, los 4 campos que tiene ya están completos en el listado + el Sheet de edición.

**Lecturas** (Server Component):
- `getServices(tenantId)` — todos los servicios del tenant (activos e inactivos), ordenados por `category` y luego `name`.

**Mutaciones** (Server Actions, patrón `ActionResult<T>` establecido):
- `createService`, `updateService` en `lib/service-actions.ts` (archivo nuevo).
- `toggleServiceActive(serviceId, isActive)` — solo toca `is_active`, sin confirmación (acción reversible con un clic).
- `deleteService(serviceId)` — ~~mapea `error.code === "23503"` a "No se puede eliminar: este servicio ya fue usado en turnos." (mismo patrón que `deleteClient`)~~. **Desde `0011`:** llama al RPC `soft_delete_service`, que marca `deleted_at` y apaga `is_active`. Ya no hay error de FK que mapear; los únicos errores que quedan son de permiso (`42501`, sólo el dueño elimina) y de servicio inexistente (`22023`).

**No se toca `agenda-queries.ts`**: `getActiveServices` sigue como está — es un flujo de lectura distinto (solo activos, para el modal de turno), no hay beneficio en tocarlo para este módulo.

## Componentes y archivos

Reutiliza el design system tal cual (`Card`, `Badge`, `EmptyState`, `Sheet`, `Field`/`Input`, la spec de Tabla de `docs/ui-design-system.md` sección 9).

```
apps/web/lib/service-types.ts     — ServiceRecord (Tables<"services">), ServiceInput
apps/web/lib/service-queries.ts   — getServices(tenantId)
apps/web/lib/service-actions.ts   — createService, updateService, toggleServiceActive, deleteService

apps/web/app/dashboard/servicios/page.tsx           — Server Component: getServices → ServicesList
apps/web/app/dashboard/servicios/ServicesList.tsx    — Client Component: agrupa por category ("Sin categoría" para null/vacío) en memoria, una tabla por grupo, toggle activo/inactivo por fila, botón "Nuevo servicio" → ServiceFormSheet modo alta, click en el nombre de un servicio → ServiceFormSheet modo edición
apps/web/app/dashboard/servicios/ServiceFormSheet.tsx — Sheet reutilizable alta/edición (prop mode: "create" | "edit"), campos: nombre* / duración en minutos* / precio* / categoría / checkbox "Activo" (true por default en alta)
```

`components/Sidebar.tsx`: `implemented: false → true` en el ítem de Servicios.

**Detalles de comportamiento:**
- Precio formateado con `Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" })`, mismo helper que ya usa `apps/web/app/dashboard/page.tsx`. Duración como `"60 min"`.
- Validación mínima en el form: nombre no vacío, duración > 0, precio ≥ 0.
- Sin búsqueda instantánea (a diferencia de Clientes): a la escala típica de un catálogo de salón (10-40 servicios), agrupar por categoría ya resuelve la navegación.
- `EmptyState` para tenant sin servicios todavía, con acción "Nuevo servicio".
- Sin realtime (mismo criterio que Clientes): `router.refresh()` tras cada mutación alcanza.

## Testing

- `tests/security/servicios-behavior.test.ts`:
  1. Operador no puede crear un servicio (RLS bloquea `services_insert`).
  2. Operador no puede editar un servicio (RLS bloquea `services_update`).
  3. Supervisor sí puede crear y editar.
  4. Supervisor **no puede** eliminar un servicio (owner únicamente). Desde `0011` se verifica por los dos caminos: el RPC `soft_delete_service` y el `DELETE` directo que bloquea `services_delete`.
  5. Owner sí puede eliminar un servicio sin uso — desde `0011`, queda con `deleted_at` e `is_active = false` en vez de desaparecer de la tabla.
  6. ~~Borrar un servicio con uso en `appointment_services` falla por FK (`23503`), a propósito.~~ **Desde `0011` afirma lo contrario:** eliminar un servicio ya usado funciona, y el turno conserva su `price_snapshot`.
- `tests/e2e/servicios.spec.ts`: alta de servicio con categoría → aparece agrupado correctamente en el listado → editar → desactivar → confirmar (vía RPC/lectura directa, o cruzando a `/dashboard/agenda`) que un servicio inactivo no aparece más en el modal de nuevo turno.

## Fuera de alcance (confirmado con el usuario)

- Búsqueda/filtro en el listado — no hace falta a la escala actual.
- Ficha de detalle por servicio — no hay contenido adicional que amerite una ruta propia.
- `service_supplies` / `supplies` (consumo de insumos por servicio) — es el módulo Inventario, no este.
- Categorías como catálogo cerrado (selector con opciones fijas, gestión de categorías) — `category` sigue siendo texto libre.
