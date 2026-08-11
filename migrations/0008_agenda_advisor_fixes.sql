-- ============================================================================
-- BeautyCRM — 0008_agenda_advisor_fixes.sql
-- Correcciones tras revisar los Security Advisors de Supabase post
-- 0007_agenda_module:
--  1) btree_gist quedó instalada en 'public' — se mueve a 'extensions'
--     (recomendación estándar: no instalar extensiones en el schema public).
--  2) public.book_appointment no tenía el EXECUTE revocado de PUBLIC, así
--     que quedaba invocable por 'anon' — se restringe a 'authenticated',
--     mismo patrón que public.provision_tenant (0005_public_rpc_wrappers).
-- ============================================================================

alter extension btree_gist set schema extensions;

revoke all on function public.book_appointment(uuid, uuid, uuid, timestamptz, uuid[], appointment_source) from public;
grant execute on function public.book_appointment(uuid, uuid, uuid, timestamptz, uuid[], appointment_source) to authenticated;
