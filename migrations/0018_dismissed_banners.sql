-- ============================================================================
-- BeautyCRM — 0018_dismissed_banners.sql
--
-- Carteles (promoción, tips, tutoriales) que se pueden cerrar con una X y no
-- vuelven a aparecer — ni al recargar, ni al volver a iniciar sesión, ni
-- desde otro dispositivo. Por eso no alcanza con localStorage: se guarda un
-- array de claves por usuario en public.users, que ya tiene RLS para que
-- cada quien sólo toque su propia fila (users_update_self, 0001).
-- ============================================================================

alter table public.users
  add column dismissed_banners text[] not null default '{}';
