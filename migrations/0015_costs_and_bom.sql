-- ============================================================================
-- BeautyCRM — 0015_costs_and_bom.sql
--
-- Dos cosas:
--   1) El costo de insumos y productos deja de ser legible por cualquier
--      miembro del tenant. Sólo dueña y encargada.
--   2) El BOM (qué insumos consume cada servicio) se puede guardar de forma
--      atómica, para que cargar el stock una vez alcance: cada servicio
--      vendido lo descuenta solo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) El costo, fuera del alcance de la operadora
-- ---------------------------------------------------------------------------
-- RLS de Postgres es por FILA, no por columna: no existe una policy que diga
-- "esta persona no ve esta columna". La única forma es a nivel de GRANT, y
-- como no se puede "quitar" una columna de un select ya otorgado, la receta
-- es revocar la tabla entera y volver a otorgarla columna por columna.
--
-- ⚠ MANTENIMIENTO: toda columna nueva que se agregue a supplies o
-- retail_products nace INVISIBLE hasta que se la sume a estos grants.
-- Si agregás una columna en una migración futura, acordate de esto.
--
-- service_role no se toca: los tests y los procesos de servidor lo usan.

revoke select on public.supplies from authenticated, anon;
grant  select (id, tenant_id, name, unit, deleted_at)
  on public.supplies to authenticated;

revoke select on public.retail_products from authenticated, anon;
grant  select (id, tenant_id, name, sale_price, deleted_at)
  on public.retail_products to authenticated;

-- ---------------------------------------------------------------------------
-- 2) v_inventory pierde el costo
-- ---------------------------------------------------------------------------
-- La vista es security_invoker = true: lee con los permisos de quien
-- consulta. Sacado el grant de la columna, la vista tampoco la puede leer,
-- así que sale de la definición. sale_price se queda — la cajera lo necesita
-- y no revela la estructura de costos.
--
-- Va drop + create y no create or replace: Postgres no deja quitar una
-- columna de una vista con replace.
drop view if exists public.v_inventory;

create view public.v_inventory
with (security_invoker = true) as
select
  b.tenant_id,
  b.id   as branch_id,
  b.name as branch_name,
  s.id   as item_id,
  'supply'::inventory_item_type as item_type,
  s.name,
  s.unit,
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

-- ---------------------------------------------------------------------------
-- 3) El costo, por la puerta autorizada
-- ---------------------------------------------------------------------------
-- security definer para poder leer las columnas que acabamos de revocar,
-- con el chequeo de rol adentro. Devuelve todo el catálogo de una: la
-- pantalla de Inventario los necesita todos, y una llamada por ítem sería
-- un N+1 contra una función.
create or replace function app.inventory_costs(p_tenant_id uuid)
returns table(item_id uuid, item_type inventory_item_type, cost numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not app.has_role(p_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_SEE_COSTS' using errcode = '42501';
  end if;

  return query
    select s.id, 'supply'::inventory_item_type, s.cost_per_unit
      from supplies s
     where s.tenant_id = p_tenant_id and s.deleted_at is null
    union all
    select p.id, 'product'::inventory_item_type, p.cost
      from retail_products p
     where p.tenant_id = p_tenant_id and p.deleted_at is null;
end;
$function$;

create or replace function public.inventory_costs(p_tenant_id uuid)
returns table(item_id uuid, item_type inventory_item_type, cost numeric)
language sql security definer set search_path to 'public'
as $$ select * from app.inventory_costs(p_tenant_id) $$;

revoke all on function public.inventory_costs(uuid) from public;
grant execute on function public.inventory_costs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) El BOM de un servicio, guardado de una
-- ---------------------------------------------------------------------------
-- Reemplazo completo en una transacción. Hacerlo en dos llamadas desde el
-- cliente (borrar y después insertar) significa que una falla en el medio
-- deja el servicio consumiendo insumos equivocados — y eso descuenta stock
-- mal en CADA venta posterior, en silencio.
create or replace function app.set_service_bom(
  p_service_id uuid,
  p_lines      jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  ln          jsonb;
begin
  select tenant_id into v_tenant_id from services where id = p_service_id;
  if v_tenant_id is null then
    raise exception 'SERVICE_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_SET_BOM' using errcode = '42501';
  end if;

  delete from service_supplies where service_id = p_service_id;

  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    if coalesce((ln->>'quantity_consumed')::numeric, 0) <= 0 then
      raise exception 'INVALID_BOM_QUANTITY' using errcode = '22023';
    end if;

    -- El insumo tiene que ser del mismo tenant: sin esto se podría armar un
    -- BOM que apunte al insumo de otro salón.
    if not exists (
      select 1 from supplies
       where id = (ln->>'supply_id')::uuid
         and tenant_id = v_tenant_id
         and deleted_at is null
    ) then
      raise exception 'SUPPLY_NOT_FOUND' using errcode = '22023';
    end if;

    -- on conflict: si la misma línea viene repetida en el jsonb, gana la
    -- última en vez de romper contra la PK (service_id, supply_id).
    insert into service_supplies (service_id, supply_id, quantity_consumed)
    values (p_service_id, (ln->>'supply_id')::uuid, (ln->>'quantity_consumed')::numeric)
    on conflict (service_id, supply_id)
      do update set quantity_consumed = excluded.quantity_consumed;
  end loop;
end;
$function$;

create or replace function public.set_service_bom(p_service_id uuid, p_lines jsonb)
returns void
language sql security definer set search_path to 'public'
as $$ select app.set_service_bom(p_service_id, p_lines) $$;

revoke all on function public.set_service_bom(uuid, jsonb) from public;
grant execute on function public.set_service_bom(uuid, jsonb) to authenticated;
