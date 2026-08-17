# Módulo Reportes — Spec de diseño

**Fecha:** 2026-08-17
**Ruta:** `/dashboard/reportes`
**Estado del esquema:** nada nuevo. Todo sale de tablas que ya existen:
`sales`/`sale_items`/`payments` (Caja, `0013`), `appointments` (Agenda,
`0001`/`0007`), `inventory` + `app.inventory_costs` (Inventario, `0012`/`0015`).

## Objetivo

Que la dueña (y la encargada, acotada a su sucursal) puedan ver, sin abrir
una planilla, cuánto vendió el salón en un período, qué se vende más, cómo
viene la agenda, y cuánto vale el inventario parado — y sacarlo en CSV para
el contador.

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Quién ve Reportes | Dueña (todo el tenant) y encargada (su sucursal) | Mismo criterio que `cash_sessions_select` (`0001`): reportes financieros no son cosa de operadora |
| Cómo se filtra por rol | En la query, no en RLS | `sales_select`/`commission_ledger_select` ya son de lectura amplia (deuda documentada en el spec de Caja); acotar acá es más simple que tocar policies compartidas con otros módulos |
| Rango de fechas | Selector con default "este mes" | Sin rango, `sales` crece sin límite y la primera carga se vuelve lenta |
| Ocupación de agenda | Turnos por estado (`done`/`cancelled`/`no_show`/`booked`) en el rango, no % de horario disponible | No existe un concepto de horario comercial en el esquema; inventarlo para esto sería alcance nuevo, no un reporte sobre lo que ya hay |
| Valorización de inventario | `Σ current_stock × cost` vía `app.inventory_costs` | Es "ahora", no tiene rango de fechas — es una foto del stock actual |
| Exportación | CSV del detalle de ventas del rango, generado en el cliente | No hay volumen que justifique un job de servidor; `Blob` + link alcanza |

## Capa de datos (`apps/web/lib/reportes-queries.ts`)

Todas reciben `tenantId`, `from`, `to` (ISO date) y un `branchId` opcional
(la encargada siempre lo manda, la dueña puede dejarlo vacío = todo el
tenant):

- `getSalesSummary` — total vendido, cantidad de ventas, ticket promedio,
  sobre `sales` no anuladas (`voided_at is null`) del rango.
- `getTopItems` — top 5 servicios y top 5 productos por monto, agregando
  `sale_items` (join a `sales` para filtrar rango/sucursal/anuladas).
- `getAppointmentsByStatus` — conteo de `appointments` por `status` en el
  rango.
- `getInventoryValuation` — `Σ current_stock × cost` sobre `v_inventory` +
  `inventory_costs`, sin rango (estado actual). Sólo se llama si el rol
  puede ver costos (`owner`/`supervisor` — mismo chequeo que ya hace el RPC).
- `getSalesDetailForExport` — filas planas (fecha, ítem, cantidad, unit_price,
  operador, medio de pago) para el CSV.

## UI

Una pantalla, `/dashboard/reportes`.

**Filtros:** rango de fechas (`type="date"` × 2, default primer/último día
del mes actual) y, si el tenant es multi-sede, selector de sucursal (la
encargada lo ve fijo en la suya).

**KPIs** (`ReportesSummary`): tarjetas con total vendido, cantidad de
ventas, ticket promedio, valorización de inventario.

**Top ítems** (`TopItemsTable`): dos tablas chicas, servicios y productos,
por monto vendido en el rango.

**Agenda** (`AppointmentsStatusCard`): conteo por estado, así se ve de un
vistazo cuánto se cancela o no se presenta.

**Exportar CSV:** botón que arma el CSV en el cliente a partir de
`getSalesDetailForExport` (server component la trae, el botón cliente sólo
arma el `Blob` y dispara la descarga).

### Convenciones heredadas

- Server component para las queries, client component sólo para filtros y
  el botón de export (mismo split que el resto de los módulos).
- Montos con `Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" })`.
- Textos en español rioplatense.

## Verificación

### Invariantes contra la base (`test:reportes`)

1. Una operadora no puede acceder a la página (redirect) — se verifica a
   nivel de la función de datos, no sólo de UI: las queries de Reportes,
   llamadas directamente, no filtran por rol solas, así que el test verifica
   que la página en sí gatea el acceso (se prueba redirigiendo, ver E2E)
2. Una encargada sólo ve las ventas de su propia sucursal en `getSalesSummary`
3. La dueña ve todas las sucursales cuando no filtra ninguna
4. `getInventoryValuation` no revienta si `inventory_costs` rechaza (rol sin
   permiso) — devuelve `null`, la UI lo oculta en vez de romper la página
5. Ventas anuladas no entran en ningún total
6. Un tenant no ve datos de otro (ya lo garantiza `sales_select`, se confirma
   que las queries no agregan una fuga adicional)

### E2E

Dueña genera una venta y un turno cancelado → entra a Reportes → ve el total
correcto, el turno cancelado contado, y puede exportar el CSV.

## Fuera de alcance

- Gráficos (charts) — v1 es tablas y tarjetas; si hace falta, se agrega una
  librería de charting después sin tocar la capa de datos
- Comparación entre períodos (mes actual vs anterior)
- Reportes por operadora individual más allá de lo que ya expone Comisiones
- Exportación a PDF
