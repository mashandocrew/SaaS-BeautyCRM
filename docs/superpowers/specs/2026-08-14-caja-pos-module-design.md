# Módulo Caja / POS — Spec de diseño

**Fecha:** 2026-08-14
**Ruta:** `/dashboard/caja`
**Estado del esquema:** las tablas del motor financiero ya existen desde `0001`
(`cash_sessions`, `sales`, `sale_items`, `payments`, `commission_ledger`), y
`0004` ya trae el trigger `on_sale_item_inserted` que descuenta inventario y
liquida comisión. Este módulo agrega el camino de escritura, la anulación y la
UI.

## Objetivo

Cobrar lo que el salón produce: los turnos que vienen de la agenda y las ventas
sueltas de mostrador. Dejar cada venta registrada de forma que la comisión y el
arqueo del día se puedan explicar meses después sin tener que confiar en la
memoria de nadie.

## Principio rector

**Una venta es un documento contable, no una fila editable.** Se confirma o no
existe; se anula con asientos que compensan, nunca se corrige en el lugar. Todo
lo demás en este diseño se deduce de esa frase.

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Alcance v1 | Cobro de turnos **y** venta de mostrador, con arqueo | Sin mostrador, los productos de reventa cargados en Inventario no tienen salida |
| Quién opera la caja | Dueña, encargada, y toda operadora con el permiso `can_operate_cash` prendido | En un salón real la persona del mostrador suele ser una operadora; cargarla como encargada para que pueda cobrar le daría también agenda, clientes, servicios e inventario completos |
| Error de cobro | Anulación de la venta entera, sólo dueña, con compensación | Cobrar mal pasa todo el tiempo; sin salida, el arqueo no cierra nunca |
| Camino de escritura | Un solo RPC por operación | Cuatro escrituras acopladas necesitan una transacción, y el precio no puede venir del cliente |

## Arquitectura

### El precio lo pone el servidor

`confirm_sale` recibe `item_id`, `item_type`, `quantity` y `operator_id`. **No
recibe `unit_price`.** Lo lee de `services.price` o `retail_products.sale_price`
y lo congela en `sale_items.unit_price`.

Si el precio viajara desde el browser, cualquiera con la sesión abierta cobra un
servicio a $0. La UI igual muestra el precio mientras se arma el carrito —hay que
ver qué se está cobrando—, pero es informativo: el que vale es el que resuelve el
RPC, y la UI muestra el total que devolvió el servidor.

**De dónde sale el precio, en orden:**

1. **Si el ítem viene de un turno**, del `price_snapshot` de
   `appointment_services`. Es el precio que se le cotizó al cliente al agendar, y
   cobrarle otra cosa porque el catálogo cambió en el medio sería cobrarle
   distinto de lo que se le dijo.
2. **Si no**, del catálogo: `services.price` o `retail_products.sale_price`.

En venta de mostrador sólo se pueden cargar servicios con `is_active = true` y
productos con `deleted_at is null`. Los ítems que vienen de un turno no pasan por
ese filtro: se agendaron cuando el servicio estaba activo, y desactivarlo después
no puede dejar un turno sin poder cobrarse.

### Atomicidad

Una venta son cuatro escrituras acopladas: `sales`, `sale_items` (que dispara el
trigger que descuenta stock y liquida comisión) y `payments`. Encadenar server
actions las pone en transacciones distintas: una falla intermedia deja stock
descontado sin venta cobrada. Todo pasa dentro de `confirm_sale`.

### El stock deja rastro

`app.process_sale_item` hoy hace `update inventory set current_stock = ... - n`
directo, sin escribir `inventory_movements`. Es deuda conocida que dejó el módulo
Inventario, y se paga acá: desde el momento en que el POS venda, el historial de
stock empezaría a mentir.

Para no duplicar la mecánica, se extrae de `app.adjust_stock` un helper interno:

```
app.apply_stock_delta(tenant, branch, item_id, item_type, delta, reason, note)
  -- sin chequeo de permisos: lock FOR UPDATE, update del saldo,
  -- insert en inventory_movements. Pura mecánica.
```

Y queda:

- `app.adjust_stock` = chequeo de rol + `apply_stock_delta`
- `app.process_sale_item` = `apply_stock_delta` con `reason = 'venta'`

Una sola implementación del lock y del movimiento; dos puertas con permisos
distintos. El enum `inventory_movement_reason` ya incluye `'venta'` desde `0012`
justamente para esto.

### Una venta nunca se bloquea por falta de stock

Si el BOM dice que no queda insumo, el saldo va a negativo y la venta se registra
igual. Negarse a cobrar un servicio ya prestado porque un número no cuadra es
peor que el número en negativo — que además es visible en el módulo Inventario y
se corrige con un recuento.

Esto es una diferencia deliberada con `adjust_stock`, que **sí** rechaza dejar el
stock negativo: ahí la persona está declarando un movimiento y puede corregir el
número; acá el servicio ya se prestó.

### El descuento no toca la comisión

`sales.discount` es un monto en pesos sobre el total de la venta. La comisión se
sigue calculando sobre `unit_price * quantity`, sin restar el descuento — o sea
que **el descuento lo absorbe el salón, no la operadora**.

Es la decisión correcta para un salón: el descuento normalmente lo autoriza la
dueña como gesto comercial, y hacérselo pagar a quien prestó el servicio sería
sorpresivo. Queda escrito porque no es evidente mirando el código.

Sin descuentos por línea: obligarían a definir si el % de comisión sale del
precio con o sin descuento, y para un salón alcanza con "te hago $2000 menos".

## Migración `0013`

### Anulación

`sales` suma `voided_at timestamptz`, `voided_by uuid references users(id)` y
`void_reason text`. Timestamp nullable, no un enum de estado — mismo idioma que
`deleted_at` en `services`, `supplies` y `retail_products`.

El motivo es **obligatorio** al anular: sin él, la diferencia de arqueo del mes
siguiente no se puede explicar.

### Sesión única por sucursal

```sql
create unique index one_open_session_per_branch
  on cash_sessions (branch_id) where closed_at is null;
```

En la base y no en la aplicación: dos pestañas abiertas saltean cualquier chequeo
hecho con un `select` previo.

### RPCs

Todos con el patrón de `0012`: lógica en `app.`, wrapper público, `revoke all
from public` + `grant execute to authenticated`, autorización adentro vía
`app.has_role`.

| RPC | Rol | Devuelve |
|---|---|---|
| `confirm_sale(p_branch_id, p_client_id, p_appointment_id, p_items jsonb, p_payments jsonb, p_discount)` | owner, supervisor | `sale_id`, `total` |
| `void_sale(p_sale_id, p_reason)` | owner | `void` |
| `open_cash_session(p_branch_id, p_opening_amount)` | owner, supervisor | `session_id` |
| `close_cash_session(p_session_id, p_counted_total)` | owner, supervisor | `expected_total`, `counted_total`, `difference` |

Errores, con la disciplina ya establecida (`42501` permisos, `22023` regla de
negocio, el mensaje discrimina):

`NO_OPEN_SESSION`, `PAYMENTS_DONT_MATCH_TOTAL`, `EMPTY_SALE`,
`APPOINTMENT_ALREADY_CHARGED`, `DISCOUNT_EXCEEDS_TOTAL`, `SALE_ALREADY_VOIDED`,
`SESSION_ALREADY_CLOSED`, `SESSION_ALREADY_OPEN`, `ITEM_NOT_FOUND`,
`NOT_ALLOWED_TO_*`.

### Reglas que `confirm_sale` hace cumplir

**Toda venta necesita una caja abierta** en esa sucursal. Sin sesión abierta,
falla con `NO_OPEN_SESSION` — no existe la venta "suelta" fuera del arqueo,
porque sería efectivo que entró al cajón sin quedar en ningún cierre.

**Un turno se cobra una sola vez.** Si ya existe una venta no anulada con ese
`appointment_id`, falla con `APPOINTMENT_ALREADY_CHARGED`. Sin esto, dos
pestañas abiertas —o un doble click— cobran el turno dos veces, descuentan el
stock dos veces y liquidan la comisión dos veces. Si la venta se anula, el turno
vuelve a quedar cobrable.

**Cobrar cierra el turno.** Si viene `p_appointment_id` y el turno no está en
`done`, `confirm_sale` lo pasa a `done` en la misma transacción: cobrar es la
señal más confiable de que el servicio se prestó, y obligar a marcarlo aparte
garantiza agendas llenas de turnos cobrados que figuran pendientes.

**Una venta no puede estar vacía** (`EMPTY_SALE`) ni tener descuento mayor al
total.

### Anulación, en detalle

`void_sale` en una transacción:

1. Marca `voided_at`, `voided_by`, `void_reason`. La venta no se borra ni se edita.
2. Devuelve el stock: por cada `sale_item`, `apply_stock_delta` con el delta
   invertido y `reason = 'ajuste'`, con nota que referencia la venta anulada.
   Para servicios recorre el BOM, igual que a la ida.
3. Revierte la comisión: por cada asiento de `commission_ledger` de esa venta,
   inserta uno nuevo con `amount` negativo, mismo `sale_item_id`, mismo `period`,
   y un `rule_snapshot` que marca la reversión. **El asiento original no se
   toca** — es lo que mantiene auditable una liquidación pasada.

### Cierre de policies

Hoy `sales_insert` habilita a todo el tenant, y `sale_items_all` / `payments_all`
dan escritura completa a cualquier miembro — incluida la operadora. Eso no
sostiene la decisión de "dueña y supervisora": es una regla de UI que se saltea
con un `curl`.

Las tres pasan a **sólo `select`**, mismo criterio que `inventory_movements` en
`0012`. El único camino de escritura son los RPC.

## Permiso de caja por persona (`0014`)

`memberships.can_operate_cash boolean not null default false`. El default en
`false` es lo que hace el cambio compatible hacia atrás: toda operadora
existente conserva exactamente el comportamiento anterior.

`app.can_operate_cash(tenant_id)` devuelve true para dueña y encargada
siempre —lo tienen por el rol, no se les puede sacar— y para la operadora
sólo con el flag prendido. `confirm_sale`, `open_cash_session` y
`close_cash_session` lo usan en lugar de `has_role`.

**`void_sale` no cambia: sigue siendo sólo de la dueña.** Anular mueve plata
y stock hacia atrás; que lo haga quien cobró anula el control.

### Por qué el permiso se toca por RPC

`memberships_update` es owner-only. Ampliarla a la encargada para que pueda
tocar este flag también le permitiría editar su propio `role` y ponerse
`owner` — escalada de privilegios. `set_cash_permission(tenant, user, can)`
escribe una sola columna y nada más.

### Por qué la caja de la cajera vive en `/o/caja`

Las páginas bajo `/dashboard` (Clientes, Inventario, Servicios) no chequean
rol por su cuenta: confían en el redirect general de
`dashboard/layout.tsx:17`. Aflojar ese redirect para dejar entrar a la
cajera obligaría a poner una guarda en cada página, y alcanza con olvidarse
de una para filtrar datos.

`/o` ya existe como área operativa, con su layout y su BottomNav. `/o/caja`
monta el mismo `CajaScreen`, sin el panel de permisos y sin cobro de turnos
por `?turno=`. `/dashboard/layout.tsx` no se toca.

El permiso se prende y se saca desde el panel **"Quién puede cobrar"** en
`/dashboard/caja`.

## Arqueo

```
expected_total = opening_amount
               + Σ pagos en EFECTIVO de las ventas no anuladas de la sesión
difference     = counted_total − expected_total
```

**Sólo efectivo:** tarjeta, transferencia y MP no están en el cajón; incluirlos
haría que el arqueo nunca cierre. Quedan igual en `payments` para Reportes.

**Las ventas anuladas quedan afuera del esperado.** Ésta es la razón concreta por
la que anular escribe compensación en vez de borrar: si la venta desapareciera,
el efectivo que sí entró y salió del cajón desaparecería del cálculo.

Una sesión cerrada es inmutable: es el documento contable del día.

## UI

Una sola pantalla, `/dashboard/caja`, con tres estados.

**Sin caja abierta:** sólo "Abrir caja" y el monto inicial del cajón.

**Caja abierta:**

- *Nueva venta.* Buscador de servicios y productos, carrito, cliente opcional
  (`sales.client_id` es nullable: se puede cobrar a alguien sin ficha), descuento
  y pagos.
- *Ventas del turno.* Listado con total, medio de pago y estado. "Anular" en cada
  una, sólo para la dueña, pidiendo motivo.
- *Cerrar caja.*

**Caja cerrada:** el resumen del arqueo — esperado, contado y diferencia.

### Cada línea del carrito lleva operadora

Es lo que decide la comisión. Viniendo de un turno se completa sola con quien lo
atendió; en mostrador es un select que arranca **vacío**, y vacío significa "sin
comisión". Explícito a propósito: asignarle una venta a alguien por descuido le
cambia la liquidación del mes.

### Entrada desde la agenda

Un turno en `in_progress` o `done` suma un botón "Cobrar" que lleva a
`/dashboard/caja?turno=<id>`. El carrito nace con los servicios del turno, sus
operadoras y el cliente ya elegidos.

### Pagos

Varias filas (`cash`, `card`, `transfer`, `mp`, `other`), combinables. La UI
muestra cuánto falta asignar y no habilita confirmar hasta que cierre; la
validación real está igual en el RPC.

### Convenciones heredadas

- Sin selector de sucursal (tenant `mode='single'`, doc A.3) — misma
  auto-selección que Inventario, **con el fallback a `getDefaultBranch`**: la
  membresía de la dueña tiene `branch_id = null` por diseño de `provision_tenant`.
- Sin `useEffect` para sembrar formularios: estado en los inicializadores de
  `useState`, montaje condicional con `key` (commit `7173ee8`).
- Formularios con `noValidate`; la validación se muestra en el banner del Sheet
  (commit `26388bd`).
- Textos en español rioplatense.

## Verificación

### Invariantes contra la base (`test:caja`)

Tenants descartables vía admin API, borrados en el `finally` — mismo patrón que
los otros cuatro módulos.

1. La operadora no puede confirmar ni anular una venta
2. Nadie escribe `sales` / `sale_items` / `payments` directo — sólo los RPC
3. El precio lo pone el servidor: un `unit_price` inventado no cambia lo cobrado,
   y un ítem que viene de un turno se cobra al `price_snapshot` cotizado, no al
   precio de catálogo actual
4. Pagos que no suman el total → rechazado, sin venta a medio escribir
5. Vender descuenta stock **y** deja movimiento `'venta'` en el historial
6. Anular devuelve el stock, revierte la comisión con asiento negativo, y no
   borra nada
7. Una venta anulada sale del `expected_total` del arqueo
8. Dos aperturas simultáneas en la misma sucursal → la segunda falla
9. Cobrar el mismo turno dos veces → la segunda falla; tras anular, vuelve a
   ser cobrable
10. Confirmar sin caja abierta → rechazado
11. Aislamiento cross-tenant
12. La operadora cobra sólo con el permiso prendido
13. La cajera con permiso igual no puede anular
14. La cajera no puede autoasignarse el permiso ni editarse el rol
15. La encargada puede prender y sacar el permiso

### E2E

Abrir caja → cobrar un turno desde la agenda → venta de mostrador con pago mixto
→ anular una venta → cerrar caja y verificar la diferencia.

## Fuera de alcance

- Liquidación de comisiones (`settled`) — es el módulo Comisiones
- Reportes y gráficos — es el módulo Reportes
- Impresión de ticket / factura electrónica
- Devolución parcial (sólo se anula la venta entera)
- Transferencias de caja entre sucursales
- Integración de cobro con Mercado Pago: `payments.method = 'mp'` registra que se
  cobró por MP, no lo procesa
