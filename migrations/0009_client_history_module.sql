-- ============================================================================
-- BeautyCRM — 0009_client_history_module.sql
-- Módulo Clientes: permite editar client_history (hoy solo se puede
-- insertar, vía el trigger de Agenda y vía app/o/cliente/actions.ts) y
-- agrega una vista de lectura resuelta con nombre de servicio/operadora/
-- sucursal ya armados, mismo criterio que v_agenda (0007_agenda_module).
-- ============================================================================

-- Restringido a owner/supervisor: mismo criterio que clients_delete
-- (0001_initial_schema), y este módulo entero vive bajo /dashboard, que ya
-- es owner/supervisor-only (dashboard/layout.tsx redirige operadoras a /o).
-- OJO: esta policy controla QUÉ FILAS se pueden tocar, no qué columnas —
-- la barrera de "solo se edita technical_notes" es de la Server Action
-- (Task 4: updateHistoryNotes hace .update({ technical_notes }) explícito,
-- nunca un update genérico), no de RLS.
create policy client_history_update on public.client_history for update
  using (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]))
  with check (app.has_role(tenant_id, array['owner','supervisor']::membership_role[]));

-- v_client_history: lectura resuelta para la ficha del cliente.
-- security_invoker=true: respeta las RLS de client_history/services/
-- users/branches, no las bypassea. Nota: puede haber filas con
-- service_id NULL (apps/web/app/o/cliente/actions.ts inserta notas de la
-- operadora sin servicio asociado) — ahí service_name sale NULL, es
-- comportamiento esperado, no un bug de la vista.
create or replace view public.v_client_history
with (security_invoker = true) as
select
  ch.id, ch.tenant_id, ch.client_id, ch.appointment_id,
  ch.service_id, s.name as service_name,
  ch.operator_id, u.full_name as operator_name,
  ch.branch_id, b.name as branch_name,
  ch.performed_at, ch.technical_notes, ch.photos
from client_history ch
left join services s on s.id = ch.service_id
left join users u on u.id = ch.operator_id
left join branches b on b.id = ch.branch_id;
