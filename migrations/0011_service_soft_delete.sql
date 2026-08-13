-- ============================================================================
-- BeautyCRM — 0011_service_soft_delete.sql
-- Eliminar un servicio del catálogo pasa a ser un borrado suave.
--
-- El borrado real no es viable sin romper cosas que importan más que la
-- prolijidad de la tabla:
--   * appointment_services tiene PK compuesta (appointment_id, service_id)
--     con service_id NOT NULL — no se puede poner en null al borrar sin
--     rehacer la clave primaria.
--   * esa misma fila guarda price_snapshot, que es la plata facturada del
--     turno. Borrarla en cascada borraría el histórico de facturación y de
--     comisiones.
--   * el nombre del servicio no está snapshoteado en ningún lado:
--     v_client_history lo saca joineando services por id (ver 0009). Si la
--     fila desaparece, la ficha del cliente muestra "Nota" en vez del
--     servicio que se hizo.
--
-- Con deleted_at la fila sobrevive para el historial y desaparece de todo
-- lo que mira hacia adelante: catálogo (getServices) y modal de nuevo turno
-- (getActiveServices) filtran deleted_at is null, y como el borrado también
-- apaga is_active, app.book_appointment ya lo rechaza sin tocar ese RPC.
-- ============================================================================

alter table public.services
  add column if not exists deleted_at timestamptz;

-- Índice parcial: todas las lecturas del catálogo filtran por tenant y por
-- "no eliminado", así que ese es el índice que las sirve.
create index if not exists idx_services_tenant_alive
  on public.services using btree (tenant_id)
  where deleted_at is null;

-- SECURITY DEFINER y no un UPDATE suelto desde la app: eliminar es
-- owner-only (igual que la policy services_delete), pero la policy
-- services_update deja escribir también a la supervisora. Si el borrado
-- suave fuera un update común, cualquier supervisora podría eliminar
-- servicios — un permiso que hoy no tiene. La función chequea el rol a mano
-- y es el único camino para setear deleted_at.
create or replace function app.soft_delete_service(p_service_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id
  from services
  where id = p_service_id and deleted_at is null;

  if v_tenant_id is null then
    raise exception 'SERVICE_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_DELETE_SERVICE' using errcode = '42501';
  end if;

  update services
     set deleted_at = now(),
         is_active = false
   where id = p_service_id;
end;
$function$;

-- Wrapper público — mismo patrón y misma advertencia que 0005/0008: crear
-- una función deja el EXECUTE abierto a PUBLIC (incluido 'anon') salvo que
-- se revoque explícitamente.
create or replace function public.soft_delete_service(p_service_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  select app.soft_delete_service(p_service_id);
$function$;

revoke all on function app.soft_delete_service(uuid) from public;
revoke all on function public.soft_delete_service(uuid) from public;
grant execute on function public.soft_delete_service(uuid) to authenticated;
