-- Producción OLE → Abordaje (solapa "Mi producción").
-- Tabla + bucket privado + RLS para que cada asesor vea SOLO su propia
-- producción (o admin todas). Asistentes NO acceden (sin policy is_assistant_of).
-- El Tablero OLE publica acá (sesión admin); Abordaje lee por user_id.

-- Tabla de reportes OLE por usuario
create table public.ole_reportes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  vista        text not null check (vista in ('anual','obj1','obj2')),
  storage_path text not null,
  resumen      jsonb,
  updated_at   timestamptz not null default now(),
  unique (user_id, vista)
);
alter table public.ole_reportes enable row level security;

-- Lectura: solo lo propio o admin (asistentes NO)
create policy ole_reportes_select on public.ole_reportes
  for select using (user_id = auth.uid() or private.is_admin());
-- Escritura: solo admin (lo publica el tablero con la sesion admin)
create policy ole_reportes_insert on public.ole_reportes
  for insert with check (private.is_admin());
create policy ole_reportes_update on public.ole_reportes
  for update using (private.is_admin()) with check (private.is_admin());
create policy ole_reportes_delete on public.ole_reportes
  for delete using (private.is_admin());

-- Bucket privado para los PDFs
insert into storage.buckets (id, name, public) values ('ole-reportes','ole-reportes', false)
  on conflict (id) do nothing;

-- Storage: leer solo el PDF propio (path = {user_id}/...) o admin
create policy ole_storage_select on storage.objects
  for select using (
    bucket_id = 'ole-reportes'
    and ( (storage.foldername(name))[1] = auth.uid()::text or private.is_admin() )
  );
-- Storage: escribir solo admin
create policy ole_storage_write on storage.objects
  for all using ( bucket_id = 'ole-reportes' and private.is_admin() )
  with check ( bucket_id = 'ole-reportes' and private.is_admin() );
