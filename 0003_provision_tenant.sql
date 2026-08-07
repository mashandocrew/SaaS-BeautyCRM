-- ============================================================================
-- BeautyCRM — 0003_provision_tenant.sql
-- Encapsula el Paso 0 del onboarding low-touch (arquitectura, Bloque A.4)
-- en una única función transaccional. Dar de alta al PRÓXIMO cliente (el
-- "clon" de Jacintas Nails) pasa a ser una llamada RPC, no SQL manual.
--
-- Seguridad: SECURITY DEFINER porque un usuario recién registrado todavía
-- no tiene membership (y por lo tanto no pasaría las policies de RLS para
-- insertar en tenants/branches/memberships). El dueño del tenant SIEMPRE
-- es auth.uid() — nunca un parámetro — para que nadie pueda provisionar
-- un tenant a nombre de otro usuario.
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

  -- evita que un usuario ya dueño de un tenant dispare un alta duplicada por error
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

  -- presets de comisión estándar (Paso 3 del onboarding): editables después,
  -- nunca se ofrece una pantalla vacía.
  insert into commission_rules (tenant_id, name, base_salary, service_pct, product_sale_pct)
  values
    (v_tenant_id, 'Solo sueldo',       0, 0,  0),
    (v_tenant_id, '% por servicio',    0, 40, 10),
    (v_tenant_id, 'Mixto',             0, 20, 5);

  return query select v_tenant_id, v_branch_id;
end;
$$;

revoke all on function app.provision_tenant(text, tenant_mode, text, text, int, text) from public;
grant execute on function app.provision_tenant(text, tenant_mode, text, text, int, text) to authenticated;
