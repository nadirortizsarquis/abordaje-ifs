-- Cerramos la escalada de privilegios via assistant_of_id.
-- Hasta ahora, update_own_metadata solo bloqueaba cambiar `role`. Eso permitía
-- que un user no-admin se auto-asignara `assistant_of_id = otroAgenteId` y
-- ganara acceso al workspace ajeno via private.is_assistant_of().
--
-- Nuevos campos inmutables desde update propio:
--   - role                (ya estaba)
--   - assistant_of_id     ← NUEVO
--   - email               ← NUEVO (suplantación de identidad)
--
-- Los admin siguen pudiendo cambiar esos campos para cualquier user via las
-- policies admin_update / admin_insert.
-- Los campos que un user SÍ puede actualizar en su propio profile:
--   display_name, advisor_name_ole, abordaje_settings, gcal_enabled,
--   shares_calendar_with_assistant.

drop policy if exists update_own_metadata on public.profiles;

create policy update_own_metadata on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    AND role = (select role from public.profiles where id = auth.uid())
    AND assistant_of_id is not distinct from (select assistant_of_id from public.profiles where id = auth.uid())
    AND email = (select email from public.profiles where id = auth.uid())
  );
