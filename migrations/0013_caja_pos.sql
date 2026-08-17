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

-- ---------------------------------------------------------------------------
-- 5) Confirmar una venta
-- ---------------------------------------------------------------------------
-- Todo en una transacción. Cuatro escrituras acopladas (sales, sale_items —
-- que dispara el trigger que descuenta stock y liquida comisión —, y
-- payments): encadenarlas desde el cliente las pondría en transacciones
-- distintas, y una falla intermedia dejaría stock descontado sin venta
-- cobrada.
--
-- No recibe unit_price a propósito: si el precio viajara desde el browser,
-- cualquiera con la sesión abierta cobraría un servicio a $0.
create or replace function app.confirm_sale(
  p_branch_id      uuid,
  p_client_id      uuid,
  p_appointment_id uuid,
  p_items          jsonb,
  p_payments       jsonb,
  p_discount       numeric default 0
)
returns table(sale_id uuid, total numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id  uuid;
  v_session_id uuid;
  v_sale_id    uuid;
  v_subtotal   numeric := 0;
  v_discount   numeric := coalesce(p_discount, 0);
  v_total      numeric;
  v_paid       numeric := 0;
  v_price      numeric;
  v_qty        numeric;
  v_op         uuid;
  it           jsonb;
  pay          jsonb;
begin
  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_SELL' using errcode = '42501';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_SALE' using errcode = '22023';
  end if;

  if v_discount < 0 then
    raise exception 'NEGATIVE_DISCOUNT' using errcode = '22023';
  end if;

  -- Toda venta necesita caja abierta: no existe el efectivo que entra al
  -- cajón sin quedar en ningún cierre.
  select id into v_session_id from cash_sessions
   where branch_id = p_branch_id and closed_at is null;
  if v_session_id is null then
    raise exception 'NO_OPEN_SESSION' using errcode = '22023';
  end if;

  if p_appointment_id is not null then
    if not exists (select 1 from appointments
                    where id = p_appointment_id and tenant_id = v_tenant_id) then
      raise exception 'APPOINTMENT_NOT_FOUND' using errcode = '22023';
    end if;
    -- Un turno se cobra una sola vez. Sin esto, un doble click cobra dos
    -- veces, descuenta stock dos veces y liquida comisión dos veces.
    if exists (select 1 from sales
                where appointment_id = p_appointment_id and voided_at is null) then
      raise exception 'APPOINTMENT_ALREADY_CHARGED' using errcode = '22023';
    end if;
  end if;

  insert into sales (tenant_id, branch_id, appointment_id, client_id,
                     total, discount, cash_session_id, created_by)
  values (v_tenant_id, p_branch_id, p_appointment_id, p_client_id,
          0, v_discount, v_session_id, auth.uid())
  returning id into v_sale_id;

  for it in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((it->>'quantity')::numeric, 1);
    if v_qty <= 0 then
      raise exception 'INVALID_QUANTITY' using errcode = '22023';
    end if;

    v_op := nullif(it->>'operator_id', '')::uuid;
    if v_op is not null and not exists (
      select 1 from memberships where tenant_id = v_tenant_id and user_id = v_op
    ) then
      raise exception 'OPERATOR_NOT_IN_TENANT' using errcode = '22023';
    end if;

    v_price := null;

    -- 1) Si el ítem viene de un turno, gana el precio que se le cotizó al
    --    cliente al agendar. Cobrarle el catálogo actual sería cobrarle
    --    distinto de lo que se le dijo.
    if p_appointment_id is not null and (it->>'item_type') = 'service' then
      select price_snapshot into v_price
        from appointment_services
       where appointment_id = p_appointment_id
         and service_id = (it->>'item_id')::uuid;
    end if;

    -- 2) Si no, el catálogo. Un ítem que viene de un turno no pasa por el
    --    filtro de is_active / deleted_at: se agendó cuando el servicio
    --    estaba activo, y desactivarlo después no puede dejar un turno sin
    --    poder cobrarse.
    if v_price is null then
      if (it->>'item_type') = 'service' then
        select price into v_price from services
         where id = (it->>'item_id')::uuid and tenant_id = v_tenant_id and is_active;
      else
        select sale_price into v_price from retail_products
         where id = (it->>'item_id')::uuid and tenant_id = v_tenant_id and deleted_at is null;
      end if;
    end if;

    if v_price is null then
      raise exception 'ITEM_NOT_FOUND' using errcode = '22023';
    end if;

    insert into sale_items (sale_id, item_type, item_id, quantity, unit_price, operator_id)
    values (v_sale_id, (it->>'item_type')::sale_item_type, (it->>'item_id')::uuid,
            v_qty, v_price, v_op);

    v_subtotal := v_subtotal + (v_price * v_qty);
  end loop;

  if v_discount > v_subtotal then
    raise exception 'DISCOUNT_EXCEEDS_TOTAL' using errcode = '22023';
  end if;

  v_total := v_subtotal - v_discount;

  for pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    if (pay->>'amount')::numeric <= 0 then
      raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = '22023';
    end if;
    insert into payments (sale_id, method, amount)
    values (v_sale_id, (pay->>'method')::payment_method, (pay->>'amount')::numeric);
    v_paid := v_paid + (pay->>'amount')::numeric;
  end loop;

  if v_paid <> v_total then
    raise exception 'PAYMENTS_DONT_MATCH_TOTAL' using errcode = '22023';
  end if;

  update sales set total = v_total where id = v_sale_id;

  -- Cobrar es la señal más confiable de que el servicio se prestó. Pedir que
  -- además se marque a mano garantiza agendas llenas de turnos cobrados que
  -- figuran pendientes.
  if p_appointment_id is not null then
    update appointments set status = 'done'
     where id = p_appointment_id and status <> 'done';
  end if;

  return query select v_sale_id, v_total;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6) Anular una venta
-- ---------------------------------------------------------------------------
-- La venta no se borra ni se edita: se marca anulada y se escriben asientos
-- que compensan. Si se borrara, el efectivo que sí entró y salió del cajón
-- desaparecería del arqueo.
create or replace function app.void_sale(
  p_sale_id uuid,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype;
  it     record;
  r      record;
  led    record;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_sale.tenant_id, array['owner']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_VOID' using errcode = '42501';
  end if;

  if v_sale.voided_at is not null then
    raise exception 'SALE_ALREADY_VOIDED' using errcode = '22023';
  end if;

  -- El motivo es obligatorio: sin él, la diferencia de arqueo del mes que
  -- viene no se puede explicar.
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  -- 1) Devolver el stock, con su movimiento en el historial.
  for it in select * from sale_items where sale_id = p_sale_id
  loop
    if it.item_type = 'service' then
      for r in select supply_id, quantity_consumed from service_supplies
                where service_id = it.item_id
      loop
        perform app.apply_stock_delta(
          v_sale.tenant_id, v_sale.branch_id, r.supply_id, 'supply',
          r.quantity_consumed * it.quantity, 'ajuste',
          'Anulación de la venta ' || p_sale_id, true
        );
      end loop;
    else
      perform app.apply_stock_delta(
        v_sale.tenant_id, v_sale.branch_id, it.item_id, 'product',
        it.quantity, 'ajuste',
        'Anulación de la venta ' || p_sale_id, true
      );
    end if;
  end loop;

  -- 2) Revertir la comisión con un asiento negativo. El original NO se
  --    toca: es lo que mantiene auditable una liquidación pasada.
  for led in
    select cl.* from commission_ledger cl
     join sale_items si on si.id = cl.sale_item_id
    where si.sale_id = p_sale_id
      and cl.amount > 0
  loop
    insert into commission_ledger
      (tenant_id, operator_id, sale_item_id, amount, rule_snapshot, period, settled)
    values
      (led.tenant_id, led.operator_id, led.sale_item_id, -led.amount,
       jsonb_build_object('reversal_of', led.id, 'reason', p_reason),
       led.period, false);
  end loop;

  update sales
     set voided_at   = now(),
         voided_by   = auth.uid(),
         void_reason = btrim(p_reason)
   where id = p_sale_id;
end;
$function$;

-- Wrappers públicos
create or replace function public.confirm_sale(
  p_branch_id uuid, p_client_id uuid, p_appointment_id uuid,
  p_items jsonb, p_payments jsonb, p_discount numeric default 0
) returns table(sale_id uuid, total numeric)
language sql security definer set search_path to 'public'
as $$ select * from app.confirm_sale(p_branch_id, p_client_id, p_appointment_id,
                                     p_items, p_payments, p_discount) $$;

revoke all on function public.confirm_sale(uuid, uuid, uuid, jsonb, jsonb, numeric) from public;
grant execute on function public.confirm_sale(uuid, uuid, uuid, jsonb, jsonb, numeric) to authenticated;

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language sql security definer set search_path to 'public'
as $$ select app.void_sale(p_sale_id, p_reason) $$;

revoke all on function public.void_sale(uuid, text) from public;
grant execute on function public.void_sale(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) El único camino de escritura son los RPC
-- ---------------------------------------------------------------------------
-- Las policies de 0001 habilitaban insert/update a cualquier miembro del
-- tenant, incluida la operadora. Eso convertía "sólo dueña y supervisora
-- cobran" en una regla de la UI que se saltea con un curl.
drop policy if exists sales_insert   on public.sales;
drop policy if exists sales_update   on public.sales;
drop policy if exists sale_items_all on public.sale_items;
drop policy if exists payments_all   on public.payments;

create policy sale_items_select on public.sale_items for select
  using (exists (select 1 from sales s
                 where s.id = sale_items.sale_id
                   and s.tenant_id in (select app.user_tenant_ids())));

create policy payments_select on public.payments for select
  using (exists (select 1 from sales s
                 where s.id = payments.sale_id
                   and s.tenant_id in (select app.user_tenant_ids())));
