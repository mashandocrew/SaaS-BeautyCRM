-- ============================================================================
-- BeautyCRM — 0005_public_rpc_wrappers.sql
-- PostgREST solo expone los schemas 'public' y 'graphql_public' por defecto
-- (Project Settings → Data API → Exposed schemas). El schema 'app' guarda
-- funciones helper de uso INTERNO para RLS y triggers (has_role,
-- user_tenant_ids, user_branch_ids, handle_new_user, process_sale_item) —
-- esas NO deben quedar invocables desde el frontend vía supabase.rpc().
--
-- En vez de agregar 'app' a los schemas expuestos (lo que volvería público
-- TODO ese schema de una), se crea acá un wrapper delgado en 'public' SOLO
-- para lo que el frontend necesita llamar como RPC: provision_tenant
-- (Paso 0 del onboarding). Si en el futuro hace falta exponer otra función
-- de app.*, se agrega un wrapper puntual acá, nunca se abre el schema entero.
-- ============================================================================

grant usage on schema app to authenticated;

create or replace function public.provision_tenant(
  p_business_name text,
  p_mode           tenant_mode default 'single',
  p_currency       text default 'ARS',
  p_timezone       text default 'America/Argentina/Mendoza',
  p_promo_days     int default 90,
  p_branch_name    text default 'Principal'
)
returns table (tenant_id uuid, branch_id uuid)
language sql
security invoker
set search_path to 'public'
as $$
  select * from app.provision_tenant(
    p_business_name, p_mode, p_currency, p_timezone, p_promo_days, p_branch_name
  );
$$;

revoke all on function public.provision_tenant(text, tenant_mode, text, text, int, text) from public;
grant execute on function public.provision_tenant(text, tenant_mode, text, text, int, text) to authenticated;
