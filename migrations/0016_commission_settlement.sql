-- ============================================================================
-- BeautyCRM — 0016_commission_settlement.sql
--
-- commission_ledger no expone policy de update (0001): sólo el servidor
-- escribe, vía el trigger de venta. Liquidar un período es la única otra
-- escritura legítima, y va por el mismo patrón: RPC security definer,
-- chequeo de rol adentro, wrapper público con grant explícito.
-- ============================================================================

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
