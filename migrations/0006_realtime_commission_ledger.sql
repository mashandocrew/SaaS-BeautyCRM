-- Habilita Supabase Realtime sobre commission_ledger para que "Mis
-- comisiones" (apps/web/app/o/comisiones) se actualice en vivo por
-- operadora. RLS (commission_ledger_select) ya limita qué filas puede
-- ver cada quien vía Realtime, igual que en las lecturas normales.
alter publication supabase_realtime add table public.commission_ledger;
