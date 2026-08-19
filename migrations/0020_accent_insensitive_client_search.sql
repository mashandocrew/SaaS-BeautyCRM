-- ============================================================================
-- BeautyCRM — 0020_accent_insensitive_client_search.sql
--
-- searchClients (lib/agenda-actions.ts, usado en "Nuevo turno") buscaba con
-- ilike puro: "Martinez" (sin tilde, como suele escribir la gente al
-- apurarse) nunca matcheaba contra "Martínez" guardado con tilde. El
-- buscador de la pantalla de Clientes no tenía este problema porque filtra
-- client-side sobre la lista ya cargada — pero ese mismo enter sin tilde
-- tampoco matcheaba ahí si se probaba con la tilde puesta distinto; el caso
-- real reportado fue específico de Nuevo turno porque ese es el que hace
-- roundtrip a la base con ilike.
--
-- No se toca la tabla — unaccent() se aplica en la función de búsqueda.
-- ============================================================================

create extension if not exists unaccent with schema extensions;

-- Sin security definer: corre con el rol de quien llama, así que las RLS
-- policies de clients_select (0001) se siguen aplicando igual que con el
-- .select() directo que reemplaza.
create or replace function app.search_clients(p_tenant_id uuid, p_query text)
returns table(id uuid, full_name text, phone text)
language sql
stable
set search_path to 'public, extensions'
as $function$
  select c.id, c.full_name, c.phone
    from public.clients c
   where c.tenant_id = p_tenant_id
     and (
       extensions.unaccent(c.full_name) ilike extensions.unaccent('%' || p_query || '%')
       or c.phone ilike '%' || p_query || '%'
     )
   order by c.full_name
   limit 10
$function$;

create or replace function public.search_clients(p_tenant_id uuid, p_query text)
returns table(id uuid, full_name text, phone text)
language sql stable set search_path to 'public'
as $$ select * from app.search_clients(p_tenant_id, p_query) $$;

revoke all on function public.search_clients(uuid, text) from public;
grant execute on function public.search_clients(uuid, text) to authenticated;
