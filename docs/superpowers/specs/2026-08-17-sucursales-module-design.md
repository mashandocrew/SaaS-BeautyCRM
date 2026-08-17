# Módulo Sucursales — Spec de diseño

**Fecha:** 2026-08-17
**Ruta:** `/dashboard/sucursales`
**Estado del esquema:** `branches` y `tenants.mode` ya existen desde `0001`,
con RLS ya lista: `branches_insert`/`update` para dueña y encargada,
`branches_delete` y `tenants_update` (que incluye `mode`) sólo para la
dueña. No hace falta migración nueva.

## Objetivo

Que la dueña pueda administrar las sucursales del salón y pasar de mono-sede
a franquicia cambiando un booleano, tal como lo define el doc de arquitectura
(Bloque A.1, principio 2): el modelo de datos no cambia, sólo la interfaz.

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Migración nueva | Ninguna | El esquema y la RLS de `0001` ya alcanzan |
| Quién administra sucursales | Dueña y encargada crean/editan; sólo la dueña borra o cambia el modo | Ya es lo que dice la RLS existente — la UI no inventa una regla nueva |
| No quedarse sin sucursal activa | Chequeo en la action, no en la base | Es una regla de negocio ("el tenant necesita al menos una sucursal operativa"), no un invariante de fila; un `check` a nivel tabla no puede contar filas hermanas |
| Pasar a modo multi | Botón explícito en esta pantalla, separado de crear una sucursal | Activar "multi" cambia cómo se comportan Agenda/Inventario/Caja (selector de sucursal visible) en todo el tenant — no es una consecuencia automática de tener 2 filas en `branches`, es una decisión consciente de la dueña |
| Volver a modo single | No soportado en v1 | Requiere decidir qué pasa con los datos de las sucursales que dejan de existir para la UI; no es una operación simétrica a activar multi |

## Capa de datos (`apps/web/lib/sucursales-*.ts`)

**Queries:**
- `getBranches(tenantId)` — todas, activas e inactivas (a diferencia de
  `getTenantBranches` de Agenda, que sólo trae activas para selectores).

**Actions:**
- `createBranch(tenantId, input)` — tabla directa.
- `updateBranch(branchId, input)` — tabla directa (nombre, dirección, teléfono).
- `toggleBranchActive(branchId, isActive)` — antes de desactivar, cuenta
  cuántas sucursales activas quedan en el tenant; si es la última, rechaza
  con un mensaje explícito en vez de dejar el tenant sin sucursal operativa
  (que rompería `getDefaultBranch`, usado por Agenda/Inventario/Caja para
  el fallback de la dueña).
- `setTenantMode(tenantId, mode)` — `update tenants`. Pasar a `'multi'`
  revalida todas las rutas que leen `tenants.mode` (Agenda, Inventario,
  Caja, Reportes) para que el selector de sucursal aparezca sin recargar.

## UI

Una pantalla, `/dashboard/sucursales`.

**Lista de sucursales** (`BranchList`): nombre, dirección, teléfono, activa/inactiva,
con alta/edición en un Sheet — mismo patrón que `ServiceFormSheet`. Desactivar
pide confirmación; si es la última activa, el botón muestra por qué no se
puede.

**Modo del tenant** (`TenantModeCard`): muestra el modo actual
("Mono-sede" / "Multi-sede") y, si está en single, un botón "Pasar a
multi-sede" con una explicación corta de qué cambia (aparece el selector de
sucursal en el resto de la app). Sólo visible/activable para la dueña.

### Convenciones heredadas

- Sin `useEffect` para sembrar formularios.
- Formularios con `noValidate`.
- Textos en español rioplatense.

## Verificación

### Invariantes contra la base (`test:sucursales`)

1. Una operadora no puede crear, editar ni borrar sucursales, ni cambiar el modo
2. La encargada puede crear y editar, pero no borrar ni cambiar el modo
3. No se puede desactivar la única sucursal activa (rechazado en la action;
   se verifica el conteo, no un error de la base)
4. La dueña puede pasar el tenant a `multi`
5. Un miembro de otro tenant no ve ni modifica sucursales ajenas

### E2E

Dueña crea una segunda sucursal → pasa el tenant a multi-sede → entra a
Inventario y ve el selector de sucursal (antes no estaba).

## Fuera de alcance

- Volver de multi a single
- Transferencias de stock o caja entre sucursales
- Horarios comerciales por sucursal
