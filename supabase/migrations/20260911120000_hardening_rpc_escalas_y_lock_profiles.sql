-- Auditoria Comisiones 2026-09 — Fase 1 (hallazgos 3.4, 3.6, 3.14)
-- Aplicada en produccion via MCP el 2026-09-11. Este archivo es el espejo
-- versionado (fuente de verdad de migraciones del proyecto compartido).
-- 1) get_next_career_scale: solo authenticated, codigo derivado server-side.
-- 2) profile_self_update_ok: lock extendido a advisor_id + flags admin.

create or replace function public.get_next_career_scale(p_current_code integer, p_year integer)
returns table(required_billing_usd numeric, required_persistency_pct numeric)
language plpgsql
security definer
set search_path to 'comisiones', 'public'
as $function$
declare
  v_code integer;
begin
  if (select auth.uid()) is null then return; end if;
  select coalesce(max(lr.pct_cobertura), 0)::integer into v_code
  from comisiones.liquidation_rows lr
  where lr.user_id = (select auth.uid()) and lr.pct_cobertura > 0;
  if v_code <= 0 then return; end if;
  if v_code >= 60 or v_code + 5 > 60 then return; end if;
  return query
    select cs.required_billing_usd, cs.required_persistency_pct
    from comisiones.career_scales cs
    where cs.year = p_year and cs.code = v_code + 5;
end;
$function$;

revoke execute on function public.get_next_career_scale(integer, integer) from public, anon;
grant execute on function public.get_next_career_scale(integer, integer) to authenticated;

drop policy if exists update_own_metadata on public.profiles;
drop function if exists private.profile_self_update_ok(uuid, text, uuid, text, text);

create or replace function private.profile_self_update_ok(p public.profiles)
returns boolean
language sql
stable security definer
set search_path to 'public', 'private'
as $function$
  select exists (
    select 1 from public.profiles cur
    where cur.id = p.id
      and cur.role::text is not distinct from p.role::text
      and cur.assistant_of_id     is not distinct from p.assistant_of_id
      and cur.email               is not distinct from p.email
      and cur.advisor_name_ole    is not distinct from p.advisor_name_ole
      and cur.advisor_id          is not distinct from p.advisor_id
      and cur.ole_ver_produccion  is not distinct from p.ole_ver_produccion
      and cur.ole_ver_calendario_pagos is not distinct from p.ole_ver_calendario_pagos
      and cur.compartir_calendario is not distinct from p.compartir_calendario
      and cur.is_demo             is not distinct from p.is_demo
      and cur.demo_active         is not distinct from p.demo_active
  );
$function$;

create policy update_own_metadata on public.profiles
  for update
  using ((select auth.uid()) = id)
  with check (((select auth.uid()) = id) and private.profile_self_update_ok(profiles));
