-- Solapa "Calendario de pagos" (Abordaje).
-- 1) Flag por usuario para habilitar la solapa (opt-in, default OFF: solo los
--    asesores tildados en el panel admin la ven).
-- 2) Tabla ole_poliza_pago: guarda el "quién paga" (cliente/ifs/agente) elegido
--    por el asesor, pegado al numero de poliza. Persiste entre recargas de
--    reporte: el calendario se dibuja con las polizas del ultimo reporte, pero
--    esta anotacion sobrevive porque va por poliza, no por snapshot.

-- 1) Flag ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists ole_ver_calendario_pagos boolean not null default false;

-- Helper SECURITY DEFINER: ¿el caller puede ver el calendario de pagos?
create or replace function private.ole_can_ver_calpagos() returns boolean
  language sql stable security definer
  set search_path to 'public','private'
  as $$
    select coalesce((select ole_ver_calendario_pagos from public.profiles where id = auth.uid()), false);
  $$;

-- La lectura de reportes exigia ole_ver_produccion. El calendario tambien lee
-- ole_reportes.resumen (la fecha de renovacion + frecuencia por poliza), asi
-- que se permite leer si tiene CUALQUIERA de los dos flags (produccion o
-- calendario de pagos). El storage del PDF sigue gateado solo por produccion.
drop policy if exists ole_reportes_select on public.ole_reportes;
create policy ole_reportes_select on public.ole_reportes
  for select using (
    ( private.ole_can_ver() or private.ole_can_ver_calpagos() )
    and ( user_id = auth.uid() or private.is_admin() )
  );

-- 2) Tabla ole_poliza_pago ----------------------------------------------------
create table if not exists public.ole_poliza_pago (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  poliza     text not null,
  paga       text not null check (paga in ('cliente','ifs','agente')),
  updated_at timestamptz not null default now(),
  primary key (user_id, poliza)
);
alter table public.ole_poliza_pago enable row level security;

-- Cada asesor gestiona SOLO lo propio (o admin, para poder editar en nombre de
-- un asesor desde el selector).
drop policy if exists ole_poliza_pago_select on public.ole_poliza_pago;
create policy ole_poliza_pago_select on public.ole_poliza_pago
  for select using (user_id = auth.uid() or private.is_admin());

drop policy if exists ole_poliza_pago_insert on public.ole_poliza_pago;
create policy ole_poliza_pago_insert on public.ole_poliza_pago
  for insert with check (user_id = auth.uid() or private.is_admin());

drop policy if exists ole_poliza_pago_update on public.ole_poliza_pago;
create policy ole_poliza_pago_update on public.ole_poliza_pago
  for update using (user_id = auth.uid() or private.is_admin())
             with check (user_id = auth.uid() or private.is_admin());

drop policy if exists ole_poliza_pago_delete on public.ole_poliza_pago;
create policy ole_poliza_pago_delete on public.ole_poliza_pago
  for delete using (user_id = auth.uid() or private.is_admin());
