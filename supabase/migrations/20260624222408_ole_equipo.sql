-- Producción del EQUIPO (agregado), visible solo para admins.
create table public.ole_equipo (
  vista        text primary key check (vista in ('anual','obj1','obj2')),
  resumen      jsonb,
  storage_path text,
  updated_at   timestamptz not null default now()
);
alter table public.ole_equipo enable row level security;
create policy ole_equipo_select on public.ole_equipo
  for select using (private.is_admin() and private.ole_can_ver());
create policy ole_equipo_write on public.ole_equipo
  for all using (private.is_admin()) with check (private.is_admin());
