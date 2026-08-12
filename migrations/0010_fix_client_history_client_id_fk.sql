-- ============================================================================
-- BeautyCRM — 0010_fix_client_history_client_id_fk.sql
-- client_history_client_id_fkey vivía en el proyecto real como ON DELETE
-- CASCADE, pese a que migrations/0001_initial_schema.sql la define sin
-- cláusula ON DELETE (o sea, NO ACTION por default) — mismo criterio que
-- appointments_client_id_fkey y sales_client_id_fkey. El drift lo detectó
-- Task 8 del módulo Clientes (clientes-behavior.test.ts, Test 4): borrar un
-- cliente con historial borraba en cascada su historial en vez de fallar.
-- Se corrige para que la FK vuelva a bloquear el borrado, como ya
-- documenta la spec del módulo ("borrar un cliente con historial falla
-- por FK, y eso es correcto") y como ya asume deleteClient (Task 4).
-- ============================================================================

alter table public.client_history
  drop constraint client_history_client_id_fkey,
  add constraint client_history_client_id_fkey
    foreign key (client_id) references public.clients(id);
