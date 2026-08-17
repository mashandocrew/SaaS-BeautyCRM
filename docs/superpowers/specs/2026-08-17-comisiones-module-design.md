# Módulo Comisiones (lado dueña) — Spec de diseño

**Fecha:** 2026-08-17
**Ruta:** `/dashboard/comisiones`
**Estado del esquema:** `commission_rules`, `memberships.commission_rule_id` y
`commission_ledger` ya existen desde `0001`; el trigger `app.process_sale_item`
(`0004`, extendido en `0013`) ya liquida cada venta contra la regla vigente de
la membresía, con `rule_snapshot` congelado. El lado operador
(`/o/comisiones`, `ComisionesLive`) ya lee su propio ledger en tiempo real.
Este módulo agrega la superficie de dueña: gestionar reglas, asignarlas al
equipo, y liquidar el período.

## Objetivo

Que la dueña pueda armar las reglas de comisión del salón, asignarlas a cada
persona del equipo, y cerrar el mes: ver cuánto le corresponde a cada
operadora y marcarlo como liquidado sin perder el historial.

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Quién administra | Sólo dueña | `commission_rules_insert/update/delete` ya es owner-only (`0001`); no se toca |
| CRUD de reglas | Tabla directa, sin RPC | La policy ya lo permite; un RPC acá sería una capa sin motivo |
| Asignar regla a una persona | `update memberships.commission_rule_id`, tabla directa | `memberships_update` ya es owner-only |
| Liquidar el período | RPC `settle_commission_period(tenant_id, period)` | `commission_ledger` no tiene policy de `update` expuesta — sólo el servidor escribe |
| Qué se liquida | Todos los asientos no liquidados del período, de una | Liquidar de a uno no tiene sentido de negocio: el pago es mensual y por persona |
| Reversión de una venta anulada | No se toca acá | Ya la escribe `void_sale` (Caja, `0013`) con un asiento negativo del mismo período |

## Datos

Nada nuevo en el esquema salvo el RPC de liquidación. Migración `0016`:

```sql
-- Marca liquidado todo lo pendiente de un período. security definer porque
-- commission_ledger no expone update: sólo la dueña, por este único camino.
create or replace function app.settle_commission_period(p_tenant_id uuid, p_period text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int;
begin
  if not app.has_role(p_tenant_id, array['owner']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_SETTLE' using errcode = '42501';
  end if;

  update commission_ledger
     set settled = true
   where tenant_id = p_tenant_id
     and period = p_period
     and settled = false;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.settle_commission_period(p_tenant_id uuid, p_period text)
returns int
language sql security definer set search_path to 'public'
as $$ select app.settle_commission_period(p_tenant_id, p_period) $$;

revoke all on function public.settle_commission_period(uuid, text) from public;
grant execute on function public.settle_commission_period(uuid, text) to authenticated;
```

No hace falta migrar nada más: `commission_rules_select` ya es de todo el
tenant (una operadora puede ver el nombre/porcentaje de su propia regla si se
lo mostramos, aunque v1 no lo expone del lado operador), y
`commission_ledger_select` ya filtra por `operator_id = auth.uid() or owner`.

## Capa de datos (`apps/web/lib/comisiones-*.ts`)

**Queries:**
- `getCommissionRules(tenantId)` — todas las reglas del tenant.
- `getTeamWithRules(tenantId)` — memberships con `commission_rule_id`, nombre
  y rol, para el selector de asignación (mismo patrón que `getTeam` de Caja).
- `getPeriodLedger(tenantId, period)` — `commission_ledger` agrupado por
  operador, con `settled` y el total, para la vista de liquidación. `period`
  default al mes actual (`YYYY-MM`), con selector para meses anteriores.

**Actions:**
- `createCommissionRule` / `updateCommissionRule` / `deleteCommissionRule` —
  tabla directa vía Supabase client, la policy hace el resto. `deleteCommissionRule`
  falla por FK si alguna membresía la tiene asignada (a propósito, mismo
  patrón que `deleteService` con turnos: no se rompe una asignación viva en
  silencio).
- `assignCommissionRule(userId, ruleId | null)` — `update memberships`.
- `settlePeriod(tenantId, period)` — llama al RPC.

## UI

Una pantalla, `/dashboard/comisiones`, con dos secciones.

**Reglas de comisión** (`CommissionRulesPanel`): lista de reglas
(nombre, salario base, % servicio, % producto) con alta/edición en un Sheet
— mismo patrón que `ServiceForm`/`SaleForm`. Debajo, el equipo con un select
por persona para asignarle una regla ("Sin regla" = no genera comisión,
opción válida por default).

**Liquidación mensual** (`CommissionSettlementPanel`): selector de período
(default mes actual), tabla por operadora con el total devengado, cuánto ya
está liquidado y cuánto pendiente, y un botón **"Liquidar [período]"** que
llama a `settlePeriod` y pide confirmación (mueve `settled` de todo el
período, es una acción de cierre). Si no queda nada pendiente, el botón se
deshabilita.

### Convenciones heredadas

- Sin `useEffect` para sembrar formularios (commit `7173ee8`).
- Formularios con `noValidate`, validación en el banner del Sheet.
- Textos en español rioplatense.

## Verificación

### Invariantes contra la base (`test:comisiones`)

1. Una operadora no puede crear, editar ni borrar una regla de comisión
2. Una operadora no puede asignarse una regla a sí misma ni a otra persona
3. Una operadora no puede llamar a `settle_commission_period`
4. La dueña liquida un período: los asientos pasan a `settled = true` y los
   de otros períodos no se tocan
5. Liquidar un período sin pendientes no rompe (devuelve 0, no error)
6. Un miembro de otro tenant no puede leer reglas ni ledger ajeno, ni liquidar
7. La operadora sigue viendo sólo su propio ledger (regresión de la policy
   existente, no nueva — se confirma que nada de esto la tocó)

### E2E

Dueña crea una regla → se la asigna a una operadora → la operadora cobra un
turno (vía flujo de Caja) → la dueña ve el devengado en Comisiones → liquida
el período → el asiento pasa a liquidado.

## Fuera de alcance

- Exportar liquidaciones a PDF/CSV para pago — lo cubre Reportes si hace falta
- Reglas por excepción a nivel de servicio puntual (`commission_rules.rules jsonb`
  ya existe en el esquema pero no se edita desde v1 de esta UI)
- Recalcular liquidaciones pasadas si se cambia una regla — `rule_snapshot`
  las protege a propósito
