-- Quitamos DELETE del admin_full_access para forzar que cualquier borrado
-- de usuarios pase por la edge function delete-user, que adicionalmente
-- restringe al megaadmin (nortiz@ifs-broker.com) y maneja cleanup CASCADE.
--
-- La policy anterior era cmd=ALL, que incluye DELETE. Cualquier admin podía
-- ejecutar sb.from('profiles').delete().eq('id', X) desde el cliente,
-- saltando la restricción de megaadmin. Ahora dejamos solo SELECT/INSERT/UPDATE.

drop policy if exists admin_full_access on public.profiles;

create policy admin_select_all on public.profiles
  for select using (private.is_admin());

create policy admin_insert on public.profiles
  for insert with check (private.is_admin());

create policy admin_update on public.profiles
  for update using (private.is_admin()) with check (private.is_admin());

-- DELETE intencionalmente NO se permite via policy: el único path es la
-- edge function delete-user (service_role + restricción a megaadmin).
