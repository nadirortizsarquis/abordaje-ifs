-- Fix RLS: INSERT ... RETURNING sobre abordaje_calendar_meetings fallaba con
-- "new row violates row-level security policy". Causa: la policy de SELECT usaba
-- private.can_see_meeting(id), que RE-CONSULTA la propia tabla meetings; durante
-- el RETURNING de un INSERT esa subconsulta no ve la fila recién insertada en su
-- snapshot -> devuelve false -> RETURNING rechazado.
--
-- Solución: en la policy de SELECT chequear el caso CREADOR inline (comparación
-- directa de columna, sin re-query) y usar función solo para el caso INVITADO,
-- que consulta la tabla invites (distinta a la que se inserta) y por eso es segura.

create or replace function private.is_meeting_invitee(m_id uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (
    select 1 from public.abordaje_calendar_meeting_invites i
    where i.meeting_id = m_id and i.invitee_id = auth.uid()
  );
$$;
revoke all on function private.is_meeting_invitee(uuid) from public, anon;
grant execute on function private.is_meeting_invitee(uuid) to authenticated;

drop policy if exists meetings_select on public.abordaje_calendar_meetings;
create policy meetings_select on public.abordaje_calendar_meetings
  for select using (creator_id = (select auth.uid()) or private.is_meeting_invitee(id));
