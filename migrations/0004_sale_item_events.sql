-- ============================================================================
-- BeautyCRM — 0004_sale_item_events.sql
-- Implementa el principio de "Eventos desacoplados" del Bloque A.1: el POS
-- no descuenta stock ni calcula comisión directamente — al insertarse un
-- sale_item se dispara app.process_sale_item(), que:
--   1) Si el ítem es un SERVICIO: descuenta insumos según el BOM
--      (service_supplies) de esa sucursal.
--   2) Si el ítem es un PRODUCTO de reventa: descuenta el producto mismo
--      del inventario de esa sucursal.
--   3) Si hay operador asignado: liquida su comisión según la regla vigente
--      en su membership, dejando rule_snapshot congelado (inmutabilidad
--      contable — si el dueño cambia el % después, las liquidaciones
--      pasadas no se reescriben).
-- ============================================================================

create or replace function app.process_sale_item()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant_id  uuid;
  v_branch_id  uuid;
  v_rule       commission_rules%rowtype;
  v_pct        numeric;
  v_amount     numeric;
  r            record;
begin
  select tenant_id, branch_id into v_tenant_id, v_branch_id
  from sales where id = new.sale_id;

  if v_tenant_id is null then
    raise exception 'sale_id % no corresponde a ninguna venta', new.sale_id;
  end if;

  -- 1) Descuento de inventario
  if new.item_type = 'service' then
    for r in
      select supply_id, quantity_consumed
      from service_supplies
      where service_id = new.item_id
    loop
      insert into inventory (branch_id, item_id, item_type, current_stock)
      values (v_branch_id, r.supply_id, 'supply', 0)
      on conflict (branch_id, item_id, item_type) do nothing;

      update inventory
        set current_stock = current_stock - (r.quantity_consumed * new.quantity)
      where branch_id = v_branch_id
        and item_id = r.supply_id
        and item_type = 'supply';
    end loop;

  elsif new.item_type = 'product' then
    insert into inventory (branch_id, item_id, item_type, current_stock)
    values (v_branch_id, new.item_id, 'product', 0)
    on conflict (branch_id, item_id, item_type) do nothing;

    update inventory
      set current_stock = current_stock - new.quantity
    where branch_id = v_branch_id
      and item_id = new.item_id
      and item_type = 'product';
  end if;

  -- 2) Liquidación de comisión (si hay operador)
  if new.operator_id is not null then
    select cr.* into v_rule
    from memberships m
    join commission_rules cr on cr.id = m.commission_rule_id
    where m.tenant_id = v_tenant_id
      and m.user_id = new.operator_id
    order by (m.branch_id = v_branch_id) desc, (m.branch_id is null) desc
    limit 1;

    if found then
      v_pct := case new.item_type
                 when 'service' then v_rule.service_pct
                 when 'product' then v_rule.product_sale_pct
                 else 0
               end;
      v_amount := (new.unit_price * new.quantity) * (v_pct / 100.0);

      insert into commission_ledger
        (tenant_id, operator_id, sale_item_id, amount, rule_snapshot, period, settled)
      values
        (v_tenant_id, new.operator_id, new.id, v_amount, to_jsonb(v_rule), to_char(now(), 'YYYY-MM'), false);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_sale_item_inserted on public.sale_items;
create trigger on_sale_item_inserted
  after insert on public.sale_items
  for each row execute function app.process_sale_item();
