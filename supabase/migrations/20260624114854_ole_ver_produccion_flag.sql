-- Control por usuario de la visibilidad de "Mi producción" (default: visible).
-- Permite quitarle la vista de producción a usuarios puntuales (ej. Bruno)
-- desde el panel admin de Abordaje. Se enforcea en RLS (no solo UI).
alter table public.profiles add column if not exists ole_ver_produccion boolean not null default true;

-- Helper SECURITY DEFINER: ¿el caller tiene permitido ver producción OLE?
create or replace function private.ole_can_ver() returns boolean
  language sql stable security definer
  set search_path to 'public','private'
  as $$
    select coalesce((select ole_ver_produccion from public.profiles where id = auth.uid()), false);
  $$;

-- Exigir el flag en la lectura de reportes (own o admin, pero solo si tiene el flag)
drop policy if exists ole_reportes_select on public.ole_reportes;
create policy ole_reportes_select on public.ole_reportes
  for select using (
    private.ole_can_ver() and ( user_id = auth.uid() or private.is_admin() )
  );

-- Exigir el flag también en el storage (descarga del PDF)
drop policy if exists ole_storage_select on storage.objects;
create policy ole_storage_select on storage.objects
  for select using (
    bucket_id = 'ole-reportes'
    and private.ole_can_ver()
    and ( (storage.foldername(name))[1] = auth.uid()::text or private.is_admin() )
  );
