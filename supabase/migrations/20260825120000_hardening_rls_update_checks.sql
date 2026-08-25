-- Hardening RLS (auditoría Fase 3).
--
-- 1) WITH CHECK explícito en el UPDATE de las tablas core. Hoy tienen USING pero
--    no WITH CHECK: una fila propia se puede actualizar cambiando agente_id a otro
--    usuario (mover el registro fuera del propio scope / hacia otro asesor). Espejamos
--    el USING en WITH CHECK: la fila resultante tiene que seguir siendo del propio
--    asesor (o admin / asistente del dueño). Legítimo = agente_id no cambia -> pasa.
alter policy prospectos_update on public.abordaje_prospectos
  with check ((agente_id = (select auth.uid())) or (select private.is_admin()) or private.is_assistant_of(agente_id));
alter policy contactos_update on public.abordaje_prospecto_contactos
  with check ((agente_id = (select auth.uid())) or (select private.is_admin()) or private.is_assistant_of(agente_id));
alter policy tareas_update on public.abordaje_tareas
  with check ((agente_id = (select auth.uid())) or (select private.is_admin()) or private.is_assistant_of(agente_id));
alter policy agendados_update on public.abordaje_agendados
  with check ((agente_id = (select auth.uid())) or (select private.is_admin()) or private.is_assistant_of(agente_id));
alter policy columnas_update on public.abordaje_tareas_columnas
  with check ((agente_id = (select auth.uid())) or (select private.is_admin()) or private.is_assistant_of(agente_id));

-- 2) meeting_id / invitee_id inmutables en los invites. La policy invites_update
--    deja al invitado editar SU fila (status accept/decline), pero sin fijar meeting_id
--    un invitado podría re-apuntar su fila a OTRO meeting y, vía la SELECT policy que
--    da acceso "soy invitee de ese meeting", leer el título de una reunión ajena.
--    RLS no ve OLD/NEW, así que la inmutabilidad la hace un trigger.
create or replace function private.meeting_invite_immutable()
returns trigger language plpgsql as $$
begin
  if new.meeting_id is distinct from old.meeting_id
     or new.invitee_id is distinct from old.invitee_id then
    raise exception 'meeting_id e invitee_id son inmutables en los invites de meeting';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meeting_invite_immutable on public.abordaje_calendar_meeting_invites;
create trigger trg_meeting_invite_immutable
  before update on public.abordaje_calendar_meeting_invites
  for each row execute function private.meeting_invite_immutable();
