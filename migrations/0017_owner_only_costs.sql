-- ============================================================================
-- BeautyCRM — 0017_owner_only_costs.sql
--
-- 0015 dejó el costo de insumos/productos visible para dueña Y encargada.
-- Corrección pedida por la clienta: el costo lo ve sólo la dueña. La
-- encargada sigue viendo todo lo demás del inventario (stock, mínimos,
-- precio de venta) — sólo pierde el costo.
-- ============================================================================

create or replace function app.inventory_costs(p_tenant_id uuid)
returns table(item_id uuid, item_type inventory_item_type, cost numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not app.has_role(p_tenant_id, array['owner']::membership_role[]) then
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
