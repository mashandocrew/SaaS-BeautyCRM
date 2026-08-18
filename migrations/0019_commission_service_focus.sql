-- ============================================================================
-- BeautyCRM — 0019_commission_service_focus.sql
--
-- Pedido de la clienta: el sueldo fijo no es una funcionalidad del CRM, es
-- un número que la dueña define aparte si quiere (el campo base_salary
-- sigue existiendo en commission_rules y en el form, opcional, 0 por
-- defecto). Lo que sale son los DOS presets que lo convertían en un
-- concepto de primera clase ("Solo sueldo", "Mixto (sueldo + %)"): acá nos
-- concentramos en la comisión por servicio.
--
-- 1) provision_tenant pasa a sembrar un solo preset, enfocado en servicio.
-- 2) Los tenants ya provisionados pierden esos dos presets — ninguno tiene
--    operadoras asignadas (verificado antes de escribir esta migración), así
--    que no hay ledger ni membership que dependa de ellos.
-- ============================================================================

create or replace function app.provision_tenant(
  p_business_name text,
  p_mode           tenant_mode default 'single',
  p_currency       text default 'ARS',
  p_timezone       text default 'America/Argentina/Mendoza',
  p_promo_days     int default 90,
  p_branch_name    text default 'Principal'
)
returns table (tenant_id uuid, branch_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'provision_tenant requiere un usuario autenticado';
  end if;

  if exists (
    select 1 from memberships
    where user_id = v_uid and role = 'owner'
  ) then
    raise exception 'El usuario % ya es dueño de un tenant existente', v_uid;
  end if;

  insert into tenants (business_name, mode, subscription_status, promo_ends_at, settings)
  values (
    p_business_name,
    p_mode,
    'promo',
    current_date + p_promo_days,
    jsonb_build_object('currency', p_currency, 'timezone', p_timezone)
  )
  returning id into v_tenant_id;

  insert into branches (tenant_id, name)
  values (v_tenant_id, p_branch_name)
  returning id into v_branch_id;

  insert into memberships (tenant_id, user_id, branch_id, role)
  values (v_tenant_id, v_uid, null, 'owner');

  -- Un solo preset (Paso 3 del onboarding): comisión por servicio, sin
  -- sueldo. Editable después — incluido agregarle un sueldo fijo si la
  -- dueña lo quiere — pero no se ofrecen presets de sueldo por defecto.
  insert into commission_rules (tenant_id, name, base_salary, service_pct, product_sale_pct)
  values
    (v_tenant_id, '% por servicio', 0, 40, 10);

  return query select v_tenant_id, v_branch_id;
end;
$$;

-- Limpieza de los tenants ya provisionados: ninguno de los dos presets tiene
-- operadoras asignadas (commission_rule_id), así que borrarlos no rompe
-- membership ni ledger.
delete from commission_rules
 where name in ('Solo sueldo', 'Mixto', 'Mixto (sueldo + %)')
   and not exists (
     select 1 from memberships m where m.commission_rule_id = commission_rules.id
   );
