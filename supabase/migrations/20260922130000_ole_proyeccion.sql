-- Modo Proyección de "Mi producción" (PM #70) — persistencia en la nube.
-- Cada asesor guarda las ventas que está por cerrar (proyección) en su fila.
-- Antes vivía en localStorage (no sobrevivía a otro dispositivo y el admin no
-- podía ver lo que cargaban los agentes). Ahora:
--   - Lectura: lo propio o admin (para que el admin VEA lo que cargó cada agente
--     y pueda especular sobre eso). Asistentes NO (sin policy is_assistant_of).
--   - Escritura: SOLO el dueño. El admin puede especular ENCIMA en su pantalla
--     (scratch local en el front), pero NO pisa el registro del agente.
create table public.ole_proyeccion (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  clientes   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ole_proyeccion enable row level security;

create policy ole_proyeccion_select on public.ole_proyeccion
  for select using (user_id = auth.uid() or private.is_admin());
create policy ole_proyeccion_insert on public.ole_proyeccion
  for insert with check (user_id = auth.uid());
create policy ole_proyeccion_update on public.ole_proyeccion
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ole_proyeccion_delete on public.ole_proyeccion
  for delete using (user_id = auth.uid());
