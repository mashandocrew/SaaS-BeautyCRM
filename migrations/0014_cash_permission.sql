-- ============================================================================
-- BeautyCRM — 0014_cash_permission.sql
-- Permiso de caja por persona.
--
-- Hasta acá sólo dueña y encargada podían cobrar. Pero en un salón real la
-- persona del mostrador suele ser una operadora, y cargarla como supervisora
-- para que pueda cobrar le daría también agenda, clientes, servicios e
-- inventario completos. Este flag separa "puede cobrar" de "es supervisora".
-- ============================================================================

alter table public.memberships
  add column if not exists can_operate_cash boolean not null default false;

-- ---------------------------------------------------------------------------
-- Quién puede operar la caja
-- ---------------------------------------------------------------------------
-- Dueña y encargada siempre — el permiso no se les puede sacar, es parte del
-- rol. La operadora, sólo con el flag prendido.
create or replace function app.can_operate_cash(p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $function$
  select exists (
    select 1 from memberships m
     where m.tenant_id = p_tenant_id
       and m.user_id = (select auth.uid())
       and (m.role in ('owner', 'supervisor') or m.can_operate_cash)
  )
$function$;

-- ---------------------------------------------------------------------------
-- Prender y sacar el permiso
-- ---------------------------------------------------------------------------
-- Por RPC y no ampliando memberships_update (que hoy es owner-only): si la
-- policy se abriera a la encargada para que toque este flag, también podría
-- editar su propio `role` y ponerse owner. Escalada de privilegios. El RPC
-- escribe UNA columna y nada más.
create or replace function app.set_cash_permission(
  p_tenant_id uuid,
  p_user_id   uuid,
  p_can       boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not app.has_role(p_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_SET_CASH_PERMISSION' using errcode = '42501';
  end if;

  update memberships
     set can_operate_cash = coalesce(p_can, false)
   where tenant_id = p_tenant_id
     and user_id = p_user_id;

  if not found then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = '22023';
  end if;
end;
$function$;

create or replace function public.set_cash_permission(
  p_tenant_id uuid, p_user_id uuid, p_can boolean
) returns void
language sql security definer set search_path to 'public'
as $$ select app.set_cash_permission(p_tenant_id, p_user_id, p_can) $$;

revoke all on function public.set_cash_permission(uuid, uuid, boolean) from public;
grant execute on function public.set_cash_permission(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Los tres RPC de caja pasan a usar el permiso
-- ---------------------------------------------------------------------------
-- Idénticos a 0013 salvo la línea de autorización. void_sale NO cambia:
-- anular mueve plata y stock hacia atrás, y que lo pueda hacer quien cobró
-- anula el control. Sigue siendo sólo de la dueña.

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

  if not app.can_operate_cash(v_tenant_id) then
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

  if not app.can_operate_cash(v_session.tenant_id) then
    raise exception 'NOT_ALLOWED_TO_CLOSE_SESSION' using errcode = '42501';
  end if;

  if v_session.closed_at is not null then
    raise exception 'SESSION_ALREADY_CLOSED' using errcode = '22023';
  end if;

  if coalesce(p_counted_total, 0) < 0 then
    raise exception 'NEGATIVE_COUNTED_TOTAL' using errcode = '22023';
  end if;

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

  if not app.can_operate_cash(v_tenant_id) then
    raise exception 'NOT_ALLOWED_TO_SELL' using errcode = '42501';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_SALE' using errcode = '22023';
  end if;

  if v_discount < 0 then
    raise exception 'NEGATIVE_DISCOUNT' using errcode = '22023';
  end if;

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

    if p_appointment_id is not null and (it->>'item_type') = 'service' then
      select price_snapshot into v_price
        from appointment_services
       where appointment_id = p_appointment_id
         and service_id = (it->>'item_id')::uuid;
    end if;

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

  if p_appointment_id is not null then
    update appointments set status = 'done'
     where id = p_appointment_id and status <> 'done';
  end if;

  return query select v_sale_id, v_total;
end;
$function$;
