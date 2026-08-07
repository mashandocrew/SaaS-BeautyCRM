-- ============================================================================
-- BeautyCRM — 0001_initial_schema.sql
-- Captura retroactiva y consolidada del esquema base (incluye ya el tuning
-- de la migración 0002_perf_tuning_rls_and_indexes aplicada en producción).
-- Reproduce, en un proyecto Supabase nuevo, exactamente lo que hoy corre
-- para Jacintas Nails. Es la pieza que hace clonable la infraestructura
-- para el próximo cliente sin repetir trabajo manual.
--
-- Orden de aplicación en un proyecto nuevo:
--   1) Este archivo
--   2) 0003_provision_tenant.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Esquema app (funciones helper de autorización)
-- ---------------------------------------------------------------------------
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type tenant_mode as enum ('single','multi');
create type subscription_status as enum ('trial','promo','active','past_due','cancelled');
create type membership_role as enum ('owner','supervisor','operator');
create type supply_unit as enum ('ml','gr','unit');
create type inventory_item_type as enum ('supply','product');
create type appointment_status as enum ('booked','confirmed','in_progress','done','no_show','cancelled');
create type appointment_source as enum ('internal','google','online_booking');
create type sale_item_type as enum ('service','product');
create type payment_method as enum ('cash','card','transfer','mp','other');

-- ---------------------------------------------------------------------------
-- Núcleo de identidad y tenancy
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  mode tenant_mode not null default 'single',
  subscription_status subscription_status not null default 'trial',
  promo_ends_at date,
  stripe_customer_id text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null default 'Principal',
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id),
  full_name text,
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  base_salary numeric not null default 0,
  service_pct numeric not null default 0,
  product_sale_pct numeric not null default 0,
  rules jsonb not null default '{}'::jsonb
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references public.users(id),
  branch_id uuid references public.branches(id),
  role membership_role not null,
  commission_rule_id uuid references public.commission_rules(id),
  google_calendar_token jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, branch_id)
);

-- ---------------------------------------------------------------------------
-- Catálogo, clientes e historial estético
-- ---------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  duration_minutes int not null default 30,
  price numeric not null default 0,
  category text,
  is_active boolean not null default true
);

create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  unit supply_unit not null default 'unit',
  cost_per_unit numeric not null default 0
);

create table public.service_supplies (
  service_id uuid not null references public.services(id),
  supply_id uuid not null references public.supplies(id),
  quantity_consumed numeric not null,
  primary key (service_id, supply_id)
);

create table public.retail_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  sale_price numeric not null default 0,
  cost numeric not null default 0
);

create table public.inventory (
  branch_id uuid not null references public.branches(id),
  item_id uuid not null,
  item_type inventory_item_type not null,
  current_stock numeric not null default 0,
  min_alert_level numeric not null default 0,
  primary key (branch_id, item_id, item_type)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  full_name text not null,
  phone text,
  email text,
  birthday date,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Agenda y operación
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  client_id uuid references public.clients(id),
  operator_id uuid references public.users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appointment_status not null default 'booked',
  google_event_id text,
  source appointment_source not null default 'internal',
  created_at timestamptz not null default now()
);

create table public.appointment_services (
  appointment_id uuid not null references public.appointments(id),
  service_id uuid not null references public.services(id),
  price_snapshot numeric not null,
  primary key (appointment_id, service_id)
);

create table public.client_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id),
  appointment_id uuid references public.appointments(id),
  service_id uuid references public.services(id),
  operator_id uuid references public.users(id),
  branch_id uuid references public.branches(id),
  performed_at timestamptz not null default now(),
  technical_notes text,
  photos jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Motor financiero: caja, POS y comisiones
-- ---------------------------------------------------------------------------
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  opened_by uuid not null references public.users(id),
  opened_at timestamptz not null default now(),
  opening_amount numeric not null default 0,
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  expected_total numeric,
  counted_total numeric,
  difference numeric
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  appointment_id uuid references public.appointments(id),
  client_id uuid references public.clients(id),
  total numeric not null default 0,
  discount numeric not null default 0,
  cash_session_id uuid references public.cash_sessions(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  item_type sale_item_type not null,
  item_id uuid not null,
  quantity numeric not null default 1,
  unit_price numeric not null,
  operator_id uuid references public.users(id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  method payment_method not null,
  amount numeric not null
);

create table public.commission_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  operator_id uuid not null references public.users(id),
  sale_item_id uuid not null references public.sale_items(id),
  amount numeric not null,
  rule_snapshot jsonb not null default '{}'::jsonb,
  period text not null,
  settled boolean not null default false
);

alter table public.memberships
  add constraint fk_memberships_commission_rule
  foreign key (commission_rule_id) references public.commission_rules(id);

-- ---------------------------------------------------------------------------
-- Índices de cobertura (ya incluidos desde el día 1 en esta versión consolidada)
-- ---------------------------------------------------------------------------
create index idx_branches_tenant on public.branches using btree (tenant_id);
create index idx_memberships_user on public.memberships using btree (user_id);
create index idx_memberships_tenant on public.memberships using btree (tenant_id);
create index idx_memberships_branch on public.memberships using btree (branch_id);
create index idx_memberships_comm_rule on public.memberships using btree (commission_rule_id);
create index idx_services_tenant on public.services using btree (tenant_id);
create index idx_supplies_tenant on public.supplies using btree (tenant_id);
create index idx_service_supplies_supply on public.service_supplies using btree (supply_id);
create index idx_retail_products_tenant on public.retail_products using btree (tenant_id);
create index idx_clients_tenant on public.clients using btree (tenant_id);
create index idx_appointments_tenant_time on public.appointments using btree (tenant_id, starts_at);
create index idx_appointments_operator on public.appointments using btree (operator_id, starts_at);
create index idx_appointments_client on public.appointments using btree (client_id);
create index idx_appointments_branch on public.appointments using btree (branch_id);
create index idx_appt_services_service on public.appointment_services using btree (service_id);
create index idx_client_history_tenant on public.client_history using btree (tenant_id);
create index idx_client_history_client on public.client_history using btree (client_id, performed_at desc);
create index idx_client_history_appointment on public.client_history using btree (appointment_id);
create index idx_client_history_service on public.client_history using btree (service_id);
create index idx_client_history_operator on public.client_history using btree (operator_id);
create index idx_client_history_branch on public.client_history using btree (branch_id);
create index idx_commission_rules_tenant on public.commission_rules using btree (tenant_id);
create index idx_cash_sessions_tenant on public.cash_sessions using btree (tenant_id);
create index idx_cash_sessions_branch on public.cash_sessions using btree (branch_id, opened_at desc);
create index idx_cash_sessions_opened_by on public.cash_sessions using btree (opened_by);
create index idx_cash_sessions_closed_by on public.cash_sessions using btree (closed_by);
create index idx_sales_tenant_time on public.sales using btree (tenant_id, created_at desc);
create index idx_sales_branch on public.sales using btree (branch_id);
create index idx_sales_appointment on public.sales using btree (appointment_id);
create index idx_sales_client on public.sales using btree (client_id);
create index idx_sales_cash_session on public.sales using btree (cash_session_id);
create index idx_sales_created_by on public.sales using btree (created_by);
create index idx_sale_items_sale on public.sale_items using btree (sale_id);
create index idx_sale_items_operator on public.sale_items using btree (operator_id);
create index idx_payments_sale on public.payments using btree (sale_id);
create index idx_commission_ledger_tenant on public.commission_ledger using btree (tenant_id);
create index idx_commission_ledger_operator on public.commission_ledger using btree (operator_id, period);
create index idx_commission_ledger_saleitem on public.commission_ledger using btree (sale_item_id);

-- ---------------------------------------------------------------------------
-- Funciones helper (app schema) — usan (select auth.uid()) / SECURITY DEFINER
-- para evitar el initplan repetido por fila (fix de 0002 ya incorporado)
-- ---------------------------------------------------------------------------
create or replace function app.user_tenant_ids()
returns setof uuid
language sql stable security definer set search_path to 'public'
as $$
  select distinct tenant_id from memberships where user_id = auth.uid();
$$;

create or replace function app.has_role(p_tenant uuid, p_roles membership_role[])
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and tenant_id = p_tenant and role = any(p_roles)
  );
$$;

create or replace function app.user_branch_ids(p_tenant uuid)
returns setof uuid
language sql stable security definer set search_path to 'public'
as $$
  select b.id from branches b
  where b.tenant_id = p_tenant
    and exists (select 1 from memberships m
                where m.user_id = auth.uid() and m.tenant_id = p_tenant
                  and (m.branch_id is null or m.branch_id = b.id));
$$;

create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.users (id, full_name, email, avatar_url)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          new.email,
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS: habilitar en todas las tablas
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.branches enable row level security;
alter table public.users enable row level security;
alter table public.memberships enable row level security;
alter table public.services enable row level security;
alter table public.supplies enable row level security;
alter table public.service_supplies enable row level security;
alter table public.retail_products enable row level security;
alter table public.inventory enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;
alter table public.client_history enable row level security;
alter table public.commission_rules enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.commission_ledger enable row level security;

-- ---------------------------------------------------------------------------
-- RLS: políticas (granulares, no FOR ALL, salvo tablas puramente derivadas)
-- ---------------------------------------------------------------------------

-- tenants
create policy tenants_select on public.tenants for select
  using (id in (select app.user_tenant_ids()));
create policy tenants_update on public.tenants for update
  using (app.has_role(id, array['owner']::membership_role[]));

-- branches
create policy branches_select on public.branches for select
  using (tenant_id in (select app.user_tenant_ids()));
create policy branches_insert on public.branches for insert
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy branches_update on public.branches for update
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy branches_delete on public.branches for delete
  using (app.has_role(tenant_id, array['owner']::membership_role[]));

-- users
create policy users_select on public.users for select
  using (id = (select auth.uid())
         or exists (select 1 from memberships m
                     where m.user_id = users.id
                       and m.tenant_id in (select app.user_tenant_ids())));
create policy users_update_self on public.users for update
  using (id = (select auth.uid()));

-- memberships
create policy memberships_select on public.memberships for select
  using (tenant_id in (select app.user_tenant_ids()));
create policy memberships_insert on public.memberships for insert
  with check (app.has_role(tenant_id, array['owner']::membership_role[]));
create policy memberships_update on public.memberships for update
  using (app.has_role(tenant_id, array['owner']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner']::membership_role[]));
create policy memberships_delete on public.memberships for delete
  using (app.has_role(tenant_id, array['owner']::membership_role[]));

-- services
create policy services_select on public.services for select
  using (tenant_id in (select app.user_tenant_ids()));
create policy services_insert on public.services for insert
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy services_update on public.services for update
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy services_delete on public.services for delete
  using (app.has_role(tenant_id, array['owner']::membership_role[]));

-- supplies
create policy supplies_select on public.supplies for select
  using (tenant_id in (select app.user_tenant_ids()));
create policy supplies_insert on public.supplies for insert
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy supplies_update on public.supplies for update
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy supplies_delete on public.supplies for delete
  using (app.has_role(tenant_id, array['owner']::membership_role[]));

-- service_supplies (vía FK a services)
create policy service_supplies_select on public.service_supplies for select
  using (exists (select 1 from services s
                 where s.id = service_supplies.service_id
                   and s.tenant_id in (select app.user_tenant_ids())));
create policy service_supplies_insert on public.service_supplies for insert
  with check (exists (select 1 from services s
                       where s.id = service_supplies.service_id
                         and app.has_role(s.tenant_id, array['owner','supervisor']::membership_role[])));
create policy service_supplies_update on public.service_supplies for update
  using (exists (select 1 from services s
                 where s.id = service_supplies.service_id
                   and app.has_role(s.tenant_id, array['owner','supervisor']::membership_role[])))
  with check (exists (select 1 from services s
                       where s.id = service_supplies.service_id
                         and app.has_role(s.tenant_id, array['owner','supervisor']::membership_role[])));
create policy service_supplies_delete on public.service_supplies for delete
  using (exists (select 1 from services s
                 where s.id = service_supplies.service_id
                   and app.has_role(s.tenant_id, array['owner','supervisor']::membership_role[])));

-- retail_products
create policy retail_products_select on public.retail_products for select
  using (tenant_id in (select app.user_tenant_ids()));
create policy retail_products_insert on public.retail_products for insert
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy retail_products_update on public.retail_products for update
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy retail_products_delete on public.retail_products for delete
  using (app.has_role(tenant_id, array['owner']::membership_role[]));

-- inventory (vía FK a branches)
create policy inventory_select on public.inventory for select
  using (exists (select 1 from branches b
                 where b.id = inventory.branch_id
                   and b.tenant_id in (select app.user_tenant_ids())));
create policy inventory_insert on public.inventory for insert
  with check (exists (select 1 from branches b
                       where b.id = inventory.branch_id
                         and app.has_role(b.tenant_id, array['owner','supervisor']::membership_role[])));
create policy inventory_update on public.inventory for update
  using (exists (select 1 from branches b
                 where b.id = inventory.branch_id
                   and app.has_role(b.tenant_id, array['owner','supervisor']::membership_role[])))
  with check (exists (select 1 from branches b
                       where b.id = inventory.branch_id
                         and app.has_role(b.tenant_id, array['owner','supervisor']::membership_role[])));
create policy inventory_delete on public.inventory for delete
  using (exists (select 1 from branches b
                 where b.id = inventory.branch_id
                   and app.has_role(b.tenant_id, array['owner','supervisor']::membership_role[])));

-- clients
create policy clients_select on public.clients for select
  using (tenant_id in (select app.user_tenant_ids()));
create policy clients_insert on public.clients for insert
  with check (tenant_id in (select app.user_tenant_ids()));
create policy clients_update on public.clients for update
  using (tenant_id in (select app.user_tenant_ids()))
  with check (tenant_id in (select app.user_tenant_ids()));
create policy clients_delete on public.clients for delete
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));

-- appointments (operador ve/gestiona lo suyo; supervisor/owner ven todo)
create policy appointments_select on public.appointments for select
  using (tenant_id in (select app.user_tenant_ids())
         and (operator_id = (select auth.uid())
              or app.has_role(tenant_id, array['owner','supervisor']::membership_role[])));
create policy appointments_insert on public.appointments for insert
  with check (tenant_id in (select app.user_tenant_ids())
              and (operator_id = (select auth.uid())
                   or app.has_role(tenant_id, array['owner','supervisor']::membership_role[])));
create policy appointments_update on public.appointments for update
  using (tenant_id in (select app.user_tenant_ids())
         and (operator_id = (select auth.uid())
              or app.has_role(tenant_id, array['owner','supervisor']::membership_role[])))
  with check (tenant_id in (select app.user_tenant_ids()));
create policy appointments_delete on public.appointments for delete
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));

-- appointment_services (vía FK a appointments)
create policy appointment_services_all on public.appointment_services for all
  using (exists (select 1 from appointments a
                 where a.id = appointment_services.appointment_id
                   and a.tenant_id in (select app.user_tenant_ids())))
  with check (exists (select 1 from appointments a
                       where a.id = appointment_services.appointment_id
                         and a.tenant_id in (select app.user_tenant_ids())));

-- client_history (insert-only vía trigger/app; sin update/delete expuestos)
create policy client_history_select on public.client_history for select
  using (tenant_id in (select app.user_tenant_ids()));
create policy client_history_write on public.client_history for insert
  with check (tenant_id in (select app.user_tenant_ids()));

-- commission_rules
create policy commission_rules_select on public.commission_rules for select
  using (tenant_id in (select app.user_tenant_ids()));
create policy commission_rules_insert on public.commission_rules for insert
  with check (app.has_role(tenant_id, array['owner']::membership_role[]));
create policy commission_rules_update on public.commission_rules for update
  using (app.has_role(tenant_id, array['owner']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner']::membership_role[]));
create policy commission_rules_delete on public.commission_rules for delete
  using (app.has_role(tenant_id, array['owner']::membership_role[]));

-- cash_sessions (caja: solo owner/supervisor)
create policy cash_sessions_select on public.cash_sessions for select
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy cash_sessions_insert on public.cash_sessions for insert
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy cash_sessions_update on public.cash_sessions for update
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));
create policy cash_sessions_delete on public.cash_sessions for delete
  using (app.has_role(tenant_id, array['owner']::membership_role[]));

-- sales
create policy sales_select on public.sales for select
  using (tenant_id in (select app.user_tenant_ids()));
create policy sales_insert on public.sales for insert
  with check (tenant_id in (select app.user_tenant_ids()));
create policy sales_update on public.sales for update
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));

-- sale_items (vía FK a sales)
create policy sale_items_all on public.sale_items for all
  using (exists (select 1 from sales s
                 where s.id = sale_items.sale_id
                   and s.tenant_id in (select app.user_tenant_ids())))
  with check (exists (select 1 from sales s
                       where s.id = sale_items.sale_id
                         and s.tenant_id in (select app.user_tenant_ids())));

-- payments (vía FK a sales)
create policy payments_all on public.payments for all
  using (exists (select 1 from sales s
                 where s.id = payments.sale_id
                   and s.tenant_id in (select app.user_tenant_ids())))
  with check (exists (select 1 from sales s
                       where s.id = payments.sale_id
                         and s.tenant_id in (select app.user_tenant_ids())));

-- commission_ledger (el operador ve la suya; el owner ve todas; sin insert/update expuestos: lo escribe el evento de servidor)
create policy commission_ledger_select on public.commission_ledger for select
  using (operator_id = (select auth.uid())
         or app.has_role(tenant_id, array['owner']::membership_role[]));

-- ---------------------------------------------------------------------------
-- Storage: buckets privados + políticas por tenant (primer segmento del path = tenant_id)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('client-photos', 'client-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('tenant-assets', 'tenant-assets', false)
on conflict (id) do nothing;

create policy storage_tenant_read on storage.objects for select
  using (bucket_id in ('client-photos','tenant-assets')
         and (storage.foldername(name))[1]::uuid in (select app.user_tenant_ids()));

create policy storage_tenant_write on storage.objects for insert
  with check (bucket_id in ('client-photos','tenant-assets')
              and (storage.foldername(name))[1]::uuid in (select app.user_tenant_ids()));

create policy storage_tenant_delete on storage.objects for delete
  using (bucket_id in ('client-photos','tenant-assets')
         and (storage.foldername(name))[1]::uuid in (select app.user_tenant_ids()));
