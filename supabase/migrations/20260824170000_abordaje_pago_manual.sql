-- Pagos manuales del Calendario de pagos (Abordaje). Fuente aparte del reporte
-- automático de OLE (ole_reportes.cartera): permite cargar a mano los pagos de
-- planes que no tienen reporte auto (ej. Investors Trust). Autocontenido: incluye
-- quién paga + observaciones (no usa ole_poliza_pago). Cada asesor gestiona los
-- suyos; los admin ven/gestionan todo.
create table if not exists public.abordaje_pago_manual (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  compania text not null default 'investors-trust',
  cliente text not null default '',
  asesor text not null default '',
  frecuencia text not null default 'anual',
  prima numeric,
  vencimiento date not null,
  poliza text,
  paga text check (paga in ('cliente','ifs','agente')),
  observaciones text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pago_manual_user on public.abordaje_pago_manual (user_id);

alter table public.abordaje_pago_manual enable row level security;

create policy pago_manual_select on public.abordaje_pago_manual
  for select using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy pago_manual_insert on public.abordaje_pago_manual
  for insert with check (user_id = (select auth.uid()) or (select private.is_admin()));
create policy pago_manual_update on public.abordaje_pago_manual
  for update using (user_id = (select auth.uid()) or (select private.is_admin()))
             with check (user_id = (select auth.uid()) or (select private.is_admin()));
create policy pago_manual_delete on public.abordaje_pago_manual
  for delete using (user_id = (select auth.uid()) or (select private.is_admin()));
