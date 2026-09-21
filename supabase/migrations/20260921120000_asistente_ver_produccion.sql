-- Un ASISTENTE puede ver la producción ("Mi producción") de su PRINCIPAL, pero
-- solo si el principal lo autoriza. Espeja el patrón de shares_calendar_with_assistant
-- (consentimiento del principal, opt-in, default OFF), aplicado a ole_reportes.
--
-- El asistente ve EXACTAMENTE la producción del principal (mismos números/vistas),
-- como si fuese el agente principal. Enforced en RLS (no solo UI).

-- 1) Flag de consentimiento en el perfil del PRINCIPAL (opt-in) ----------------
alter table public.profiles
  add column if not exists permitir_asistente_ver_produccion boolean not null default false;

-- 2) Helper SECURITY DEFINER: ¿el caller es asistente de `folder` (id del principal
--    como texto) Y ese principal autorizó ver su producción? Toma texto para poder
--    reusarlo en la policy de storage sin castear foldername a uuid (evita error en
--    rutas no-uuid como 'campanias/...').
create or replace function private.asistente_puede_ver_prod(folder text) returns boolean
  language sql stable security definer
  set search_path to 'public','private'
  as $$
    select exists (
      select 1
      from public.profiles me
      join public.profiles prin on prin.id = me.assistant_of_id
      where me.id = auth.uid()
        and prin.id::text = folder
        and coalesce(prin.permitir_asistente_ver_produccion, false)
    );
  $$;

-- 3) Lectura de ole_reportes: además de own/admin (con flag propio), permitir al
--    asistente leer la fila de su principal autorizado. NO regresivo: sin flag del
--    principal, esta rama es false y todo queda como antes.
drop policy if exists ole_reportes_select on public.ole_reportes;
create policy ole_reportes_select on public.ole_reportes
  for select using (
    (
      ( private.ole_can_ver() or private.ole_can_ver_calpagos() )
      and ( user_id = auth.uid() or private.is_admin() )
    )
    or private.asistente_puede_ver_prod(user_id::text)
  );

-- 4) Storage del PDF (bucket ole-reportes): mismo agregado para el asistente. La
--    carpeta {principal_id}/{vista}.pdf se compara por texto contra el id del
--    principal autorizado.
drop policy if exists ole_storage_select on storage.objects;
create policy ole_storage_select on storage.objects
  for select using (
    bucket_id = 'ole-reportes'
    and (
      (
        private.ole_can_ver()
        and ( (storage.foldername(name))[1] = auth.uid()::text or private.is_admin() )
      )
      or private.asistente_puede_ver_prod( (storage.foldername(name))[1] )
    )
  );
