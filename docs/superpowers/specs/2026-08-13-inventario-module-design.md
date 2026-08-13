# Módulo Inventario — Diseño (frontend + migración)

Fecha: 2026-08-13
Estado: Aprobado por el usuario, listo para plan de implementación.

## Contexto

BeautyCRM es un SaaS multi-tenant para salones de belleza. Agenda, Clientes y Servicios ya están en producción (`main`). El sidebar tiene un link a `/dashboard/inventario` marcado "Pronto" (`Sidebar.tsx`, `implemented: false`).

Las tablas del dominio ya existen desde `migrations/0001_initial_schema.sql` — `supplies` (insumos internos), `retail_products` (productos de reventa) e `inventory` (stock por sucursal). Este documento cubre la UI que falta más **una** migración nueva: el registro de movimientos de stock.

### El descuento automático ya existe, pero hoy nunca corre

`app.process_sale_item()` (`migrations/0004_sale_item_events.sql`) descuenta stock cuando se inserta un `sale_item`: si el ítem es un servicio, descuenta sus insumos según el BOM de `service_supplies`; si es un producto de reventa, lo descuenta directo.

**Nada en la app inserta `sale_items` todavía** — eso es Caja/POS, que no está construido. Consecuencia de producto que define el alcance de este módulo: hoy el stock sólo se mueve si alguien lo ajusta a mano, y el BOM (`service_supplies`) no tiene ningún efecto observable. Por eso el BOM queda **fuera de alcance** y este módulo se centra en saber qué hay y ajustarlo.

### Consumidores existentes de `inventory`

`app/dashboard/queries.ts` ya lee `inventory` (`item_id, item_type, current_stock, min_alert_level`) para las alertas de stock bajo del Panel de control. Ese consumidor existe desde antes que el módulo y **no se toca**: el diseño de acá mantiene `inventory.current_stock` como el saldo vigente, así que el Panel sigue funcionando sin cambios.

## Tenant de prueba

Mismo criterio que Agenda, Clientes y Servicios: tenants descartables provisionados vía admin API, nunca el tenant real de producción.

## Modelo de datos existente (no se recrea)

```sql
supplies (
  id uuid PK, tenant_id uuid FK,
  name text, unit supply_unit ('ml'|'gr'|'unit'), cost_per_unit numeric
)

retail_products (
  id uuid PK, tenant_id uuid FK,
  name text, sale_price numeric, cost numeric
)

inventory (                              -- stock SIEMPRE por sucursal
  branch_id uuid FK, item_id uuid, item_type inventory_item_type ('supply'|'product'),
  current_stock numeric, min_alert_level numeric,
  PRIMARY KEY (branch_id, item_id, item_type)
)
```

`inventory.item_id` es polimórfico: apunta a `supplies` o a `retail_products` según `item_type`, sin FK. Eso es una decisión del esquema original y no se cambia acá; su consecuencia práctica está en la vista `v_inventory` de más abajo.

Policies vigentes (`migrations/0001_initial_schema.sql`):

- `supplies_*` y `retail_products_*`: select para cualquier miembro del tenant; insert/update para owner o supervisor; **delete sólo owner**.
- `inventory_*`: resuelven el tenant vía FK a `branches`. Select para cualquier miembro; insert/update/delete para owner o supervisor.

La operadora sólo lee. `/dashboard/*` ya redirige operadoras a `/o` (`dashboard/layout.tsx`), así que este módulo no las toca en la UI, pero los tests igual verifican la barrera de RLS: las server actions reciben el `tenantId` como argumento y son endpoints públicos.

## Migración nueva: `0012_inventory_movements.sql`

### Decisión de enfoque

Se evaluaron tres formas de relacionar el registro de movimientos con el saldo:

- **A (elegida)** — registro de movimientos + `inventory.current_stock` como saldo materializado. No toca nada de lo que ya funciona.
- **B** — el registro como única verdad, con el saldo derivado. Implicaba reescribir `process_sale_item` y convertir el saldo en algo calculado: el más caro y el más riesgoso, para un beneficio que hoy no se cobra.
- **C** — A, y además modificar `process_sale_item` para que la venta también deje movimiento. Descartada por YAGNI: esa ruta hoy nunca se ejecuta.

**Deuda conocida de la opción A:** el día que Caja/POS empiece a registrar ventas, el stock va a bajar sin dejar movimiento, y el historial va a quedar incompleto. El enum `inventory_movement_reason` ya incluye `'venta'` justamente para que sumar ese registro sea agregar un `insert` a `app.process_sale_item()`, no rediseñar nada. **Esto tiene que ser parte del alcance del módulo Caja.**

### Tabla

```sql
create type inventory_movement_reason as enum
  ('compra', 'rotura', 'recuento', 'ajuste', 'venta');

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  item_id uuid not null,
  item_type inventory_item_type not null,
  delta numeric not null,
  resulting_stock numeric not null,
  reason inventory_movement_reason not null,
  note text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index idx_inventory_movements_item
  on public.inventory_movements
  using btree (branch_id, item_id, item_type, created_at desc);
```

`tenant_id` es redundante con `branch_id` y se guarda igual, por consistencia con `client_history` y porque abarata la policy de lectura.

**El recuento también se guarda como delta.** "Conté y había 7" se traduce a `delta = 7 − saldo_actual` con `reason = 'recuento'`. Así todos los movimientos suman igual y el saldo es siempre la suma del historial, en vez de tener dos formas distintas de mover stock.

**`resulting_stock` queda congelado en cada fila.** Es redundante con la suma acumulada, a propósito: es la columna que permite auditar. Si algún día el saldo y el historial no cuadran, indica exactamente en qué movimiento se separaron.

### Registro inmutable, un solo camino de escritura

`inventory_movements` lleva **solamente** policy de `select` (miembros del tenant). Sin `insert`, `update` ni `delete`: RLS deniega por defecto, así que nadie escribe esa tabla directo, ni siquiera la dueña.

La única forma de mover stock es el RPC:

```sql
app.adjust_stock(
  p_branch_id uuid,
  p_item_id uuid,
  p_item_type inventory_item_type,
  p_delta numeric,
  p_reason inventory_movement_reason,
  p_note text default null
) returns numeric   -- el saldo resultante
```

`security definer`, con su wrapper público siguiendo el patrón de `0005`/`0008` (crear una función deja el `execute` abierto a PUBLIC salvo que se revoque explícitamente). Valida en orden:

1. La sucursal existe y el usuario tiene rol `owner` o `supervisor` en su tenant — mismo permiso que `inventory_update`. Si no: `42501`.
2. El ítem existe en `supplies` o en `retail_products` según `item_type`, y pertenece al mismo tenant que la sucursal. Si no: `22023`.
3. El saldo resultante no queda negativo. Si quedara: `22023` con mensaje propio.

Después hace el upsert de la fila de `inventory` (puede no existir todavía), actualiza `current_stock` e inserta el movimiento con su `resulting_stock`, **todo en la misma transacción**. Sin esa atomicidad, un movimiento podría quedar sin su cambio de saldo y el historial pasaría a mentir.

`p_reason = 'venta'` queda disponible en el enum pero el RPC lo rechaza: las ventas no son ajustes manuales, y hoy no hay ningún llamador legítimo.

**Problema preexistente que este diseño no arregla:** `process_sale_item` no chequea saldo negativo, así que cuando exista Caja va a poder dejar el stock por debajo de cero. Se documenta acá y se deja para el módulo Caja.

`min_alert_level` se edita con un `update` común a `inventory` (o un upsert si la fila no existe), sin pasar por el RPC: no mueve stock, así que no es un movimiento.

### Eliminar un ítem: borrado suave, igual que Servicios

`supplies` y `retail_products` suman `deleted_at timestamptz`, y el borrado se hace marcando esa columna — mismo patrón y misma razón que `migrations/0011_service_soft_delete.sql`:

- `inventory_movements.item_id` es polimórfico y **no tiene FK**, así que un borrado real dejaría movimientos huérfanos apuntando a un ítem inexistente. El historial pasaría a mostrar filas sin nombre.
- `service_supplies.supply_id` sí tiene FK (`NO ACTION`), así que borrar un insumo que está en el BOM de algún servicio fallaría con `23503` — el mismo mensaje de error que acabamos de sacar de Servicios por inútil.

El borrado es **owner-only**, igual que las policies `supplies_delete` y `retail_products_delete` de hoy. Como `supplies_update` y `retail_products_update` habilitan también a la supervisora, marcar `deleted_at` con un `update` común convertiría eliminar en un permiso que la supervisora no tiene: por eso va por RPC `security definer` (`app.soft_delete_inventory_item(p_item_id, p_item_type)`), exactamente por el mismo motivo que `app.soft_delete_service`.

Un ítem eliminado desaparece de `v_inventory` y del listado; su fila de `inventory` y sus movimientos quedan intactos.

## Vista nueva: `v_inventory`

Une insumos y productos con su stock por sucursal:

```
(items del tenant) × (sucursales del tenant)  LEFT JOIN inventory
```

Devuelve: `tenant_id, branch_id, branch_name, item_id, item_type, name, unit, cost_per_unit, sale_price, current_stock, min_alert_level, below_minimum`.

Va como vista y no como merge en TypeScript por dos razones concretas: `inventory.item_id` es polimórfico y PostgREST no lo puede joinear, y con la vista el orden y el filtro "por debajo del mínimo" se resuelven en SQL. Mismo precedente que `v_client_history` (`0009`) y `v_agenda` (`0007`).

El cruce contra sucursales (en vez de un simple left join desde `inventory`) es lo que hace que un insumo recién creado aparezca con stock 0 en vez de no aparecer hasta su primer ajuste. Los campos que no aplican a un tipo de ítem vienen en `null` (`unit`/`cost_per_unit` para productos, `sale_price` para insumos).

La vista filtra `deleted_at is null` en ambos catálogos, así que los ítems eliminados no aparecen — pero sus movimientos y su fila de `inventory` siguen existiendo para el historial.

`current_stock` y `min_alert_level` se devuelven con `coalesce(..., 0)`.

## Rutas y flujo de datos

Todo en `/dashboard/inventario`, sin ruta de detalle por ítem: el historial de movimientos se muestra dentro del Sheet de ajuste, que es donde tiene sentido leerlo.

**Lecturas** (Server Component): `getInventory(tenantId)` sobre `v_inventory`, y `getItemMovements(branchId, itemId, itemType)` para los últimos movimientos del ítem.

**Escrituras** (Server Actions): alta/edición de insumos y de productos, `adjustStock` (vía RPC) y `setMinAlertLevel`. Todas con `revalidatePath("/dashboard/inventario")`, y `adjustStock` también revalida `/dashboard` porque el Panel muestra las alertas de stock bajo.

## Interfaz

Dos `Card` apiladas — *Insumos* y *Productos de reventa* — siguiendo el patrón de agrupado que ya usa `ServicesList`. No se agrega un componente de tabs a `packages/ui` para esto.

**Sin selector de sucursal.** El tenant es `mode = 'single'` y el doc de arquitectura (A.3) pide ocultarlo, con auto-selección de la única sucursal. Las transferencias entre sedes son de `mode = 'multi'` y quedan fuera de alcance.

Arriba, un `StatTile` con la cantidad de ítems por debajo del mínimo.

Cada fila: nombre, unidad (insumos) o precio de venta (productos), stock actual, mínimo, y un `Badge` "Bajo" cuando `current_stock <= min_alert_level`. Click en el nombre abre el Sheet de edición del ítem; un botón aparte abre el de ajuste.

**Sheet de ajuste.** Cuatro tipos de movimiento, y el formulario cambia según cuál se elija:

| Tipo | Qué pide el formulario | Qué se guarda |
|---|---|---|
| Compra | cantidad que entró | `delta = +cantidad`, `reason = 'compra'` |
| Rotura o pérdida | cantidad que se perdió | `delta = −cantidad`, `reason = 'rotura'` |
| Recuento | **cuánto se contó** (absoluto) | `delta = contado − saldo`, `reason = 'recuento'` |
| Otro ajuste | cantidad con signo | `delta` tal cual, `reason = 'ajuste'` |

El recuento pide un número absoluto y no un delta porque es lo que la persona realmente hace: cuenta lo que hay. La resta la hace el sistema. Debajo del formulario, los últimos movimientos de ese ítem.

**Estado de los formularios.** Los dos Sheets siembran su estado en los inicializadores de `useState` y los padres los montan condicionalmente con `key` por entidad. **No** se usa `useEffect` para hidratar campos: eso reintroduce la carrera arreglada en `7173ee8`, donde un árbol revalidado que aterrizaba con el formulario abierto pisaba en silencio lo que la persona estaba tipeando. Ver los comentarios en `ServiceFormSheet.tsx` y `ClientFormSheet.tsx`.

**Validación** en el submit y no con `min`/`step` de HTML5, siguiendo `26388bd`: la validación nativa bloquea el submit en silencio para valores perfectamente válidos. Los formularios llevan `noValidate` y muestran el error en el banner del Sheet.

## Componentes y archivos

```
migrations/0012_inventory_movements.sql        tabla, enum, RPC adjust_stock, deleted_at en
                                               ambos catálogos, RPC de borrado suave,
                                               vista v_inventory
apps/web/lib/inventory-types.ts                InventoryItem, InventoryMovement, tipos de alta
apps/web/lib/inventory-queries.ts              getInventory, getItemMovements
apps/web/lib/inventory-actions.ts              create/update de insumos y productos,
                                               deleteItem, adjustStock, setMinAlertLevel
apps/web/app/dashboard/inventario/page.tsx     Server Component, reemplaza el ComingSoon
apps/web/app/dashboard/inventario/InventoryList.tsx
apps/web/app/dashboard/inventario/ItemFormSheet.tsx
apps/web/app/dashboard/inventario/AdjustStockSheet.tsx
apps/web/components/Sidebar.tsx                implemented: true
packages/supabase/src/types.ts                 tipos de la tabla, la vista y el RPC nuevos
```

## Testing

**`apps/web/tests/security/inventario-behavior.test.ts`** — invariantes que sólo la base puede garantizar:

1. La operadora no puede crear ni editar insumos ni productos (RLS).
2. La supervisora sí puede crear y editar; borrar es sólo de la dueña.
3. La operadora no puede llamar a `adjust_stock` (`42501`).
4. Un ajuste que dejaría el saldo negativo se rechaza y **no** deja movimiento.
5. `inventory_movements` no acepta `insert`, `update` ni `delete` directos, ni siquiera de la dueña.
6. Después de una serie de ajustes, `inventory.current_stock` coincide con la suma de los `delta` y con el `resulting_stock` del último movimiento.
7. `adjust_stock` rechaza un ítem de otro tenant, y un miembro de otro tenant no ve ni el stock ni los movimientos ajenos.
8. La supervisora no puede eliminar un ítem (ni por el RPC de borrado suave ni por `delete` directo); la dueña sí, y después de eliminarlo el ítem desaparece de `v_inventory` pero sus movimientos siguen consultables.

**`apps/web/tests/e2e/inventario.spec.ts`** — el recorrido real: crear un insumo → aparece con stock 0 → compra de 10 → stock 10 → recuento de 7 → stock 7 y dos movimientos en el historial → poner el mínimo en 8 → aparece el badge "Bajo".

## Fuera de alcance (confirmado con el usuario)

- **BOM (`service_supplies`)** — qué insumo consume cada servicio. Hoy no descuenta nada porque nada inserta `sale_items`. Se construye junto con Caja, o después.
- **Transferencias entre sucursales** — son de `mode = 'multi'` según A.3.
- **Registrar la venta como movimiento** — opción C de arriba; pertenece al alcance de Caja.
- **Chequeo de saldo negativo en `process_sale_item`** — problema preexistente, mismo destino.
- **Órdenes de compra / proveedores** — no están en el esquema ni en el doc de arquitectura.
