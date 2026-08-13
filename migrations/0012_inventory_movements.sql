-- ============================================================================
-- BeautyCRM — 0012_inventory_movements.sql
-- Registro de movimientos de stock + el único camino para escribirlo.
--
-- El saldo vigente sigue viviendo en inventory.current_stock: ya lo consume
-- el Panel de control (app/dashboard/queries.ts) y lo escribe
-- app.process_sale_item (0004). Este archivo agrega el historial que
-- explica CÓMO llegó a ese número, sin tocar nada de lo anterior.
--
-- Deuda conocida para el módulo Caja: cuando el POS empiece a insertar
-- sale_items, el stock va a bajar sin dejar movimiento. El enum ya incluye
-- 'venta' para que sumarlo sea un insert dentro de app.process_sale_item.
-- ============================================================================

create type inventory_movement_reason as enum
  ('compra', 'rotura', 'recuento', 'ajuste', 'venta');

-- Borrado suave en ambos catálogos, mismo criterio que 0011 para services:
-- inventory_movements.item_id es polimórfico y NO tiene FK, así que un
-- borrado real dejaría movimientos huérfanos sin nombre; y
-- service_supplies.supply_id sí tiene FK NO ACTION, así que borrar un
-- insumo usado en un BOM fallaría con 23503.
alter table public.supplies add column if not exists deleted_at timestamptz;
alter table public.retail_products add column if not exists deleted_at timestamptz;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  -- Polimórfico igual que inventory.item_id: apunta a supplies o a
  -- retail_products según item_type. Sin FK, por eso el borrado es suave.
  item_id uuid not null,
  item_type inventory_item_type not null,
  delta numeric not null,
  -- Redundante con la suma acumulada, a propósito: es lo que permite
  -- auditar. Si algún día el saldo y el historial no cuadran, esta columna
  -- dice exactamente en qué movimiento se separaron.
  resulting_stock numeric not null,
  reason inventory_movement_reason not null,
  note text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index idx_inventory_movements_item
  on public.inventory_movements
  using btree (branch_id, item_id, item_type, created_at desc);

alter table public.inventory_movements enable row level security;

-- SOLO select. Sin insert/update/delete: RLS deniega por defecto, así que
-- nadie escribe esta tabla directo, ni siquiera la dueña. El único camino
-- son los RPC de abajo, que escriben saldo y movimiento en la misma
-- transacción — sin eso, un movimiento podría quedar sin su cambio de
-- saldo y el historial pasaría a mentir.
create policy inventory_movements_select on public.inventory_movements for select
  using (tenant_id in (select app.user_tenant_ids()));

-- ---------------------------------------------------------------------------
-- Ajuste por delta (compra, rotura, ajuste manual)
-- ---------------------------------------------------------------------------
create or replace function app.adjust_stock(
  p_branch_id uuid,
  p_item_id   uuid,
  p_item_type inventory_item_type,
  p_delta     numeric,
  p_reason    inventory_movement_reason,
  p_note      text default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id   uuid;
  v_item_tenant uuid;
  v_new_stock   numeric;
begin
  -- 'venta' existe en el enum para el día que Caja registre sus descuentos,
  -- pero no es un ajuste manual: no hay llamador legítimo desde la app.
  if p_reason = 'venta' then
    raise exception 'REASON_NOT_ALLOWED' using errcode = '22023';
  end if;

  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_ADJUST_STOCK' using errcode = '42501';
  end if;

  if p_item_type = 'supply' then
    select tenant_id into v_item_tenant from supplies
     where id = p_item_id and deleted_at is null;
  else
    select tenant_id into v_item_tenant from retail_products
     where id = p_item_id and deleted_at is null;
  end if;

  if v_item_tenant is null or v_item_tenant <> v_tenant_id then
    raise exception 'ITEM_NOT_FOUND' using errcode = '22023';
  end if;

  insert into inventory (branch_id, item_id, item_type, current_stock)
  values (p_branch_id, p_item_id, p_item_type, 0)
  on conflict (branch_id, item_id, item_type) do nothing;

  -- FOR UPDATE: dos ajustes simultáneos sobre el mismo ítem tienen que
  -- serializarse. Sin el lock, ambos leerían el mismo saldo y el segundo
  -- pisaría al primero — el stock quedaría mal y el historial mostraría un
  -- resulting_stock que nunca existió.
  select current_stock into v_new_stock from inventory
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type
   for update;

  v_new_stock := v_new_stock + p_delta;

  if v_new_stock < 0 then
    raise exception 'NEGATIVE_STOCK' using errcode = '22023';
  end if;

  update inventory set current_stock = v_new_stock
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type;

  insert into inventory_movements
    (tenant_id, branch_id, item_id, item_type, delta, resulting_stock, reason, note, created_by)
  values
    (v_tenant_id, p_branch_id, p_item_id, p_item_type, p_delta, v_new_stock, p_reason,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return v_new_stock;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Recuento (cantidad absoluta)
-- ---------------------------------------------------------------------------
-- La resta "contado − saldo" se hace acá adentro y no en el cliente a
-- propósito: si el cliente calculara el delta con un saldo que leyó hace
-- unos segundos, un ajuste concurrente lo volvería incorrecto. Acá el
-- saldo se lee bajo el mismo FOR UPDATE que después se actualiza.
create or replace function app.record_stock_count(
  p_branch_id uuid,
  p_item_id   uuid,
  p_item_type inventory_item_type,
  p_counted   numeric,
  p_note      text default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id   uuid;
  v_item_tenant uuid;
  v_current     numeric;
begin
  if p_counted < 0 then
    raise exception 'NEGATIVE_STOCK' using errcode = '22023';
  end if;

  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_ADJUST_STOCK' using errcode = '42501';
  end if;

  if p_item_type = 'supply' then
    select tenant_id into v_item_tenant from supplies
     where id = p_item_id and deleted_at is null;
  else
    select tenant_id into v_item_tenant from retail_products
     where id = p_item_id and deleted_at is null;
  end if;

  if v_item_tenant is null or v_item_tenant <> v_tenant_id then
    raise exception 'ITEM_NOT_FOUND' using errcode = '22023';
  end if;

  insert into inventory (branch_id, item_id, item_type, current_stock)
  values (p_branch_id, p_item_id, p_item_type, 0)
  on conflict (branch_id, item_id, item_type) do nothing;

  select current_stock into v_current from inventory
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type
   for update;

  update inventory set current_stock = p_counted
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type;

  insert into inventory_movements
    (tenant_id, branch_id, item_id, item_type, delta, resulting_stock, reason, note, created_by)
  values
    (v_tenant_id, p_branch_id, p_item_id, p_item_type, p_counted - v_current, p_counted, 'recuento',
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return p_counted;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Borrado suave del ítem
-- ---------------------------------------------------------------------------
-- security definer y no un update común: eliminar es owner-only (igual que
-- supplies_delete / retail_products_delete), pero las policies de update
-- habilitan también a la supervisora. Con un update suelto, marcar
-- deleted_at convertiría eliminar en un permiso que hoy no tiene. Mismo
-- razonamiento que app.soft_delete_service en 0011.
create or replace function app.soft_delete_inventory_item(
  p_item_id   uuid,
  p_item_type inventory_item_type
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
begin
  if p_item_type = 'supply' then
    select tenant_id into v_tenant_id from supplies where id = p_item_id and deleted_at is null;
  else
    select tenant_id into v_tenant_id from retail_products where id = p_item_id and deleted_at is null;
  end if;

  if v_tenant_id is null then
    raise exception 'ITEM_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_DELETE_ITEM' using errcode = '42501';
  end if;

  if p_item_type = 'supply' then
    update supplies set deleted_at = now() where id = p_item_id;
  else
    update retail_products set deleted_at = now() where id = p_item_id;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Wrappers públicos — mismo patrón y misma advertencia que 0005/0008/0011:
-- crear una función deja el execute abierto a PUBLIC (incluido 'anon')
-- salvo que se revoque explícitamente.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_branch_id uuid, p_item_id uuid, p_item_type inventory_item_type,
  p_delta numeric, p_reason inventory_movement_reason, p_note text default null
)
returns numeric language sql security definer set search_path to 'public'
as $function$
  select app.adjust_stock(p_branch_id, p_item_id, p_item_type, p_delta, p_reason, p_note);
$function$;

create or replace function public.record_stock_count(
  p_branch_id uuid, p_item_id uuid, p_item_type inventory_item_type,
  p_counted numeric, p_note text default null
)
returns numeric language sql security definer set search_path to 'public'
as $function$
  select app.record_stock_count(p_branch_id, p_item_id, p_item_type, p_counted, p_note);
$function$;

create or replace function public.soft_delete_inventory_item(
  p_item_id uuid, p_item_type inventory_item_type
)
returns void language sql security definer set search_path to 'public'
as $function$
  select app.soft_delete_inventory_item(p_item_id, p_item_type);
$function$;

revoke all on function app.adjust_stock(uuid, uuid, inventory_item_type, numeric, inventory_movement_reason, text) from public;
revoke all on function app.record_stock_count(uuid, uuid, inventory_item_type, numeric, text) from public;
revoke all on function app.soft_delete_inventory_item(uuid, inventory_item_type) from public;
revoke all on function public.adjust_stock(uuid, uuid, inventory_item_type, numeric, inventory_movement_reason, text) from public;
revoke all on function public.record_stock_count(uuid, uuid, inventory_item_type, numeric, text) from public;
revoke all on function public.soft_delete_inventory_item(uuid, inventory_item_type) from public;

grant execute on function public.adjust_stock(uuid, uuid, inventory_item_type, numeric, inventory_movement_reason, text) to authenticated;
grant execute on function public.record_stock_count(uuid, uuid, inventory_item_type, numeric, text) to authenticated;
grant execute on function public.soft_delete_inventory_item(uuid, inventory_item_type) to authenticated;

-- ---------------------------------------------------------------------------
-- Vista: catálogos + stock por sucursal
-- ---------------------------------------------------------------------------
-- security_invoker = true: la vista corre con los permisos de quien la
-- consulta, así que respeta las RLS de supplies/retail_products/inventory
-- en vez de saltearlas. Mismo criterio que v_agenda (0007) y
-- v_client_history (0009).
--
-- El join contra branches (en vez de partir de inventory) es lo que hace
-- que un ítem recién creado aparezca con stock 0 en vez de no aparecer
-- hasta su primer ajuste.
create or replace view public.v_inventory
with (security_invoker = true) as
select
  b.tenant_id,
  b.id   as branch_id,
  b.name as branch_name,
  s.id   as item_id,
  'supply'::inventory_item_type as item_type,
  s.name,
  s.unit,
  s.cost_per_unit,
  null::numeric as sale_price,
  coalesce(inv.current_stock, 0)   as current_stock,
  coalesce(inv.min_alert_level, 0) as min_alert_level,
  -- Un mínimo en 0 significa "no me avises", no "avisame siempre": sin el
  -- primer término, todo ítem recién creado (stock 0, mínimo 0) nacería
  -- marcado como bajo.
  coalesce(inv.min_alert_level, 0) > 0
    and coalesce(inv.current_stock, 0) <= coalesce(inv.min_alert_level, 0) as below_minimum
from supplies s
join branches b on b.tenant_id = s.tenant_id
left join inventory inv
  on inv.branch_id = b.id and inv.item_id = s.id and inv.item_type = 'supply'
where s.deleted_at is null

union all

select
  b.tenant_id,
  b.id   as branch_id,
  b.name as branch_name,
  p.id   as item_id,
  'product'::inventory_item_type as item_type,
  p.name,
  null::supply_unit as unit,
  p.cost as cost_per_unit,
  p.sale_price,
  coalesce(inv.current_stock, 0)   as current_stock,
  coalesce(inv.min_alert_level, 0) as min_alert_level,
  coalesce(inv.min_alert_level, 0) > 0
    and coalesce(inv.current_stock, 0) <= coalesce(inv.min_alert_level, 0) as below_minimum
from retail_products p
join branches b on b.tenant_id = p.tenant_id
left join inventory inv
  on inv.branch_id = b.id and inv.item_id = p.id and inv.item_type = 'product'
where p.deleted_at is null;
