-- Fix RAÍZ de la recursión (42P17) de profiles. La policy update_own_metadata
-- tenía subconsultas a la PROPIA tabla profiles en su WITH CHECK
-- (SELECT p.role FROM profiles p WHERE p.id = auth.uid(), idem assistant_of_id/
-- email/advisor_name_ole). Cualquier UPDATE sobre profiles — incluidos los
-- toggles de admin sobre OTRO usuario (ole_ver_calendario_pagos, ole_ver_produccion,
-- role, etc.) — hacía recursar la policy ("infinite recursion detected in policy
-- for relation profiles"). Antes se esquivaba con RPCs SECURITY DEFINER por flag
-- (set_compartir_calendario); esto lo arregla de raíz.
--
-- Se reemplazan las subconsultas por un helper SECURITY DEFINER que lee la fila
-- propia SIN aplicar RLS (bypass) → sin recursión. Misma semántica: un self-update
-- NO puede cambiar role / assistant_of_id / email / advisor_name_ole. Los admin
-- siguen pudiendo (por la policy admin_update, is_admin), como antes.
create or replace function private.profile_self_update_ok(
  p_id uuid, p_role text, p_assistant_of_id uuid, p_email text, p_advisor_name_ole text
) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_id
      and p.role::text = p_role
      and p.assistant_of_id is not distinct from p_assistant_of_id
      and p.email is not distinct from p_email
      and p.advisor_name_ole is not distinct from p_advisor_name_ole
  );
$$;
revoke all on function private.profile_self_update_ok(uuid, text, uuid, text, text) from public, anon;
grant execute on function private.profile_self_update_ok(uuid, text, uuid, text, text) to authenticated;

drop policy if exists update_own_metadata on public.profiles;
create policy update_own_metadata on public.profiles
  for update
  using ((select auth.uid()) = id)
  with check (
    (select auth.uid()) = id
    and private.profile_self_update_ok(id, role::text, assistant_of_id, email, advisor_name_ole)
  );
