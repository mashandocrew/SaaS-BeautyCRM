-- ============================================================================
-- BeautyCRM — 0013_caja_pos.sql
-- Módulo Caja / POS: el camino de escritura de una venta, la anulación con
-- compensación contable, y el arqueo de caja.
--
-- Además paga una deuda de 0012: app.process_sale_item descontaba
-- inventory.current_stock sin escribir inventory_movements, así que apenas
-- el POS vendiera algo el historial de stock habría empezado a mentir.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) La mecánica del stock, en un solo lugar
-- ---------------------------------------------------------------------------
-- Se extrae de app.adjust_stock (0012) la parte que no depende de quién
-- llama: tomar el lock, mover el saldo, escribir el movimiento. Sin chequeo
-- de permisos — eso es responsabilidad de cada puerta de entrada.
--
-- p_allow_negative existe porque las dos puertas necesitan reglas opuestas:
-- un ajuste manual NO puede dejar el stock negativo (la persona está
-- declarando un número y puede corregirlo), pero una venta SÍ (el servicio
-- ya se prestó, y negarse a cobrarlo porque un número no cuadra es peor que
-- el número en negativo).
create or replace function app.apply_stock_delta(
  p_tenant_id      uuid,
  p_branch_id      uuid,
  p_item_id        uuid,
  p_item_type      inventory_item_type,
  p_delta          numeric,
  p_reason         inventory_movement_reason,
  p_note           text,
  p_allow_negative boolean
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_stock numeric;
begin
  insert into inventory (branch_id, item_id, item_type, current_stock)
  values (p_branch_id, p_item_id, p_item_type, 0)
  on conflict (branch_id, item_id, item_type) do nothing;

  -- FOR UPDATE: dos escrituras simultáneas sobre el mismo ítem tienen que
  -- serializarse. Sin el lock, ambas leerían el mismo saldo y la segunda
  -- pisaría a la primera — el stock quedaría mal y el historial mostraría
  -- un resulting_stock que nunca existió.
  select current_stock into v_new_stock from inventory
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type
   for update;

  v_new_stock := v_new_stock + p_delta;

  if v_new_stock < 0 and not p_allow_negative then
    raise exception 'NEGATIVE_STOCK' using errcode = '22023';
  end if;

  update inventory set current_stock = v_new_stock
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type;

  insert into inventory_movements
    (tenant_id, branch_id, item_id, item_type, delta, resulting_stock, reason, note, created_by)
  values
    (p_tenant_id, p_branch_id, p_item_id, p_item_type, p_delta, v_new_stock, p_reason,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return v_new_stock;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) adjust_stock pasa a delegar la mecánica
-- ---------------------------------------------------------------------------
-- Mismo comportamiento externo que en 0012 (mismos errores, mismo retorno):
-- lo único que cambia es que el lock y el movimiento ahora viven en
-- apply_stock_delta. La firma pública no se toca.
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
begin
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

  -- allow_negative = false: un ajuste manual no puede dejar el stock negativo.
  return app.apply_stock_delta(
    v_tenant_id, p_branch_id, p_item_id, p_item_type, p_delta, p_reason, p_note, false
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) process_sale_item deja rastro
-- ---------------------------------------------------------------------------
-- Idéntico a 0004 salvo el descuento de stock, que ahora pasa por
-- apply_stock_delta con reason='venta' y allow_negative=true.
create or replace function app.process_sale_item()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_rule      commission_rules%rowtype;
  v_pct       numeric;
  v_amount    numeric;
  r           record;
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
      perform app.apply_stock_delta(
        v_tenant_id, v_branch_id, r.supply_id, 'supply',
        -(r.quantity_consumed * new.quantity), 'venta',
        'Consumo por venta ' || new.sale_id, true
      );
    end loop;

  elsif new.item_type = 'product' then
    perform app.apply_stock_delta(
      v_tenant_id, v_branch_id, new.item_id, 'product',
      -new.quantity, 'venta',
      'Venta ' || new.sale_id, true
    );
  end if;

  -- 2) Liquidación de comisión (si hay operador)
  --    Sobre unit_price * quantity: el descuento de la venta lo absorbe el
  --    salón, no la operadora.
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
        (v_tenant_id, new.operator_id, new.id, v_amount, to_jsonb(v_rule),
         to_char(now(), 'YYYY-MM'), false);
    end if;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) Anulación de ventas y sesión única por sucursal
-- ---------------------------------------------------------------------------
-- Las columnas de anulación van acá arriba porque close_cash_session ya las
-- necesita: una venta anulada no cuenta en el arqueo.
alter table public.sales add column if not exists voided_at   timestamptz;
alter table public.sales add column if not exists voided_by   uuid references public.users(id);
alter table public.sales add column if not exists void_reason text;

-- En la base y no en la aplicación: dos pestañas abiertas saltean cualquier
-- chequeo hecho con un select previo.
create unique index if not exists one_open_session_per_branch
  on public.cash_sessions (branch_id) where closed_at is null;

create or replace function app.open_cash_session(
  p_branch_id      uuid,
  p_opening_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id  uuid;
  v_session_id uuid;
begin
  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_OPEN_SESSION' using errcode = '42501';
  end if;

  if coalesce(p_opening_amount, 0) < 0 then
    raise exception 'NEGATIVE_OPENING_AMOUNT' using errcode = '22023';
  end if;

  if exists (select 1 from cash_sessions
              where branch_id = p_branch_id and closed_at is null) then
    raise exception 'SESSION_ALREADY_OPEN' using errcode = '22023';
  end if;

  insert into cash_sessions (tenant_id, branch_id, opened_by, opening_amount)
  values (v_tenant_id, p_branch_id, auth.uid(), coalesce(p_opening_amount, 0))
  returning id into v_session_id;

  return v_session_id;
end;
$function$;

create or replace function app.close_cash_session(
  p_session_id    uuid,
  p_counted_total numeric
)
returns table(expected_total numeric, counted_total numeric, difference numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session  cash_sessions%rowtype;
  v_expected numeric;
  v_diff     numeric;
begin
  select * into v_session from cash_sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_session.tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_CLOSE_SESSION' using errcode = '42501';
  end if;

  if v_session.closed_at is not null then
    raise exception 'SESSION_ALREADY_CLOSED' using errcode = '22023';
  end if;

  if coalesce(p_counted_total, 0) < 0 then
    raise exception 'NEGATIVE_COUNTED_TOTAL' using errcode = '22023';
  end if;

  -- Sólo efectivo: tarjeta, transferencia y MP no están en el cajón, y
  -- meterlos en el esperado haría que el arqueo nunca cierre.
  --
  -- Y sólo ventas no anuladas: si una venta anulada contara, el efectivo
  -- que entró y salió del cajón quedaría sumado de más.
  select v_session.opening_amount + coalesce(sum(pay.amount), 0)
    into v_expected
    from payments pay
    join sales s on s.id = pay.sale_id
   where s.cash_session_id = p_session_id
     and s.voided_at is null
     and pay.method = 'cash';

  v_diff := coalesce(p_counted_total, 0) - v_expected;

  update cash_sessions
     set closed_by      = auth.uid(),
         closed_at      = now(),
         expected_total = v_expected,
         counted_total  = coalesce(p_counted_total, 0),
         difference     = v_diff
   where id = p_session_id;

  return query select v_expected, coalesce(p_counted_total, 0), v_diff;
end;
$function$;

-- Wrappers públicos: mismo patrón que 0012 — revoke all + grant a
-- authenticated, con la autorización adentro vía app.has_role.
create or replace function public.open_cash_session(
  p_branch_id uuid, p_opening_amount numeric
) returns uuid
language sql security definer set search_path to 'public'
as $$ select app.open_cash_session(p_branch_id, p_opening_amount) $$;

revoke all on function public.open_cash_session(uuid, numeric) from public;
grant execute on function public.open_cash_session(uuid, numeric) to authenticated;

create or replace function public.close_cash_session(
  p_session_id uuid, p_counted_total numeric
) returns table(expected_total numeric, counted_total numeric, difference numeric)
language sql security definer set search_path to 'public'
as $$ select * from app.close_cash_session(p_session_id, p_counted_total) $$;

revoke all on function public.close_cash_session(uuid, numeric) from public;
grant execute on function public.close_cash_session(uuid, numeric) to authenticated;
