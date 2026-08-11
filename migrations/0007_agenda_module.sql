-- ============================================================================
-- BeautyCRM — 0007_agenda_module.sql
-- Agenda: turnos sin solapamiento por operador (constraint EXCLUDE), alta
-- transaccional (book_appointment), historial automático al completar
-- (trigger on_appointment_completed) y lectura resuelta para el frontend
-- (vista v_agenda). Las tablas appointments/appointment_services/
-- client_history y sus policies de RLS ya existían desde 0001_initial_schema
-- — acá solo se agrega lo que faltaba para habilitar el módulo.
-- ============================================================================

create extension if not exists btree_gist;

-- Un mismo operador no puede tener dos turnos que se superpongan dentro del
-- mismo tenant, salvo que uno de ellos esté cancelado o sea no-show.
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    tenant_id with =,
    operator_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status not in ('cancelled', 'no_show'));

-- app.book_appointment: valida sucursal/tenant, permisos de quién reserva,
-- calcula ends_at a partir de la duración de los servicios elegidos, y
-- congela price_snapshot. SECURITY DEFINER porque valida permisos a mano
-- (no se apoya en RLS de INSERT para esto) y necesita insertar en dos
-- tablas de forma atómica.
create or replace function app.book_appointment(
  p_branch_id uuid,
  p_client_id uuid,
  p_operator_id uuid,
  p_starts_at timestamptz,
  p_service_ids uuid[],
  p_source appointment_source default 'internal'
)
returns table (appointment_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_duration_minutes int;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_service_count int;
begin
  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if v_tenant_id not in (select app.user_tenant_ids()) then
    raise exception 'NOT_A_MEMBER' using errcode = '42501';
  end if;

  if not (
    p_operator_id = auth.uid()
    or app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[])
  ) then
    raise exception 'NOT_ALLOWED_TO_BOOK_FOR_THIS_OPERATOR' using errcode = '42501';
  end if;

  select count(*), coalesce(sum(duration_minutes), 0)
    into v_service_count, v_duration_minutes
  from services
  where id = any(p_service_ids) and tenant_id = v_tenant_id and is_active;

  if v_service_count is null or v_service_count <> array_length(p_service_ids, 1) then
    raise exception 'INVALID_SERVICE_SELECTION' using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);

  begin
    insert into appointments (tenant_id, branch_id, client_id, operator_id, starts_at, ends_at, status, source)
    values (v_tenant_id, p_branch_id, p_client_id, p_operator_id, p_starts_at, v_ends_at, 'booked', p_source)
    returning id into v_appointment_id;
  exception
    when exclusion_violation then
      raise exception 'OPERATOR_BUSY' using errcode = '23P01';
  end;

  insert into appointment_services (appointment_id, service_id, price_snapshot)
  select v_appointment_id, s.id, s.price
  from services s
  where s.id = any(p_service_ids);

  return query select v_appointment_id, p_starts_at, v_ends_at;
end;
$function$;

-- Wrapper público delgado, mismo patrón que public.provision_tenant
-- (0005_public_rpc_wrappers): PostgREST solo expone 'public', las
-- funciones reales de negocio viven en 'app'.
--
-- NOTA HISTÓRICA: acá, en 0007, no se revocó el EXECUTE de PUBLIC sobre
-- esta función — por default en Postgres una función nueva es ejecutable
-- por PUBLIC (incluido 'anon') salvo que se revoque explícitamente. Ese
-- bug de permisos es justamente lo que corrige 0008_agenda_advisor_fixes.
create or replace function public.book_appointment(
  p_branch_id uuid,
  p_client_id uuid,
  p_operator_id uuid,
  p_starts_at timestamptz,
  p_service_ids uuid[],
  p_source appointment_source default 'internal'
)
returns table (appointment_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
security definer
set search_path to 'public'
as $function$
  select * from app.book_appointment(p_branch_id, p_client_id, p_operator_id, p_starts_at, p_service_ids, p_source);
$function$;

-- Al completar un turno (status → 'done'), genera automáticamente las filas
-- de client_history correspondientes a cada servicio del turno. El "not
-- exists" evita duplicar si el trigger corre más de una vez sobre el mismo
-- turno (ej. updates posteriores que no cambian el status).
create or replace function app.on_appointment_completed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'done' and (old.status is distinct from 'done') and new.client_id is not null then
    insert into client_history (tenant_id, client_id, appointment_id, service_id, operator_id, branch_id, performed_at)
    select new.tenant_id, new.client_id, new.id, aps.service_id, new.operator_id, new.branch_id, coalesce(new.ends_at, now())
    from appointment_services aps
    where aps.appointment_id = new.id
      and not exists (
        select 1 from client_history ch
        where ch.appointment_id = new.id and ch.service_id = aps.service_id
      );
  end if;
  return new;
end;
$function$;

create trigger trg_appointment_completed
  after update on public.appointments
  for each row execute function app.on_appointment_completed();

-- v_agenda: lectura resuelta para el calendario (cliente, operadora,
-- servicios y total ya armados) para que el frontend no reconstruya joins a
-- mano. security_invoker=true: la vista corre con los permisos de quien
-- consulta, así que sigue respetando las RLS de appointments/clients/users
-- (una operadora solo ve sus propios turnos acá también).
create or replace view public.v_agenda
with (security_invoker = true) as
select
  a.id,
  a.tenant_id,
  a.branch_id,
  a.status,
  a.starts_at,
  a.ends_at,
  a.source,
  a.google_event_id,
  a.client_id,
  c.full_name as client_name,
  c.phone as client_phone,
  a.operator_id,
  u.full_name as operator_name,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'service_id', s.id,
          'name', s.name,
          'duration_minutes', s.duration_minutes,
          'price_snapshot', aps.price_snapshot
        ) order by s.name
      )
      from appointment_services aps
      join services s on s.id = aps.service_id
      where aps.appointment_id = a.id
    ),
    '[]'::jsonb
  ) as services,
  (
    select coalesce(sum(aps.price_snapshot), 0)
    from appointment_services aps
    where aps.appointment_id = a.id
  ) as total_price
from appointments a
left join clients c on c.id = a.client_id
left join users u on u.id = a.operator_id;
