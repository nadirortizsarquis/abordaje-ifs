-- Seguridad (code-review nov 2026): las RLS de tareas / agendados / contactos solo
-- chequean agente_id, no prospecto_id. Un asesor podía colgar su fila del prospecto
-- de OTRO asesor (front, MCP o REST directo) y todo lo que confía en prospecto_id
-- (sync de auto-tareas, cascadas de borrado, limpieza de gcal, crm-sync que lee
-- contactos por prospecto_id con service role -> bitácora CRM ajena) lo trataba
-- como del dueño del prospecto.
--
-- Invariante: si una fila hija tiene prospecto_id, su agente_id = el del prospecto.
-- Aplica a todos (admins incluidos): al momento de la migración había 0 filas que lo
-- violaran (43 tareas, 9 agendados, 114 contactos con prospecto).

create or replace function private.check_prospecto_mismo_agente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dueno uuid;
begin
  if new.prospecto_id is null then
    return new;
  end if;
  select p.agente_id into dueno
    from public.abordaje_prospectos p
   where p.id = new.prospecto_id;
  -- Prospecto inexistente: lo resuelve la FK. Solo validamos el dueño.
  if found and dueno is distinct from new.agente_id then
    raise exception 'prospecto_id % no pertenece al agente de la fila', new.prospecto_id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.check_prospecto_mismo_agente() from public, anon, authenticated;

drop trigger if exists trg_tareas_prospecto_mismo_agente on public.abordaje_tareas;
create trigger trg_tareas_prospecto_mismo_agente
  before insert or update of prospecto_id, agente_id on public.abordaje_tareas
  for each row execute function private.check_prospecto_mismo_agente();

drop trigger if exists trg_agendados_prospecto_mismo_agente on public.abordaje_agendados;
create trigger trg_agendados_prospecto_mismo_agente
  before insert or update of prospecto_id, agente_id on public.abordaje_agendados
  for each row execute function private.check_prospecto_mismo_agente();

drop trigger if exists trg_contactos_prospecto_mismo_agente on public.abordaje_prospecto_contactos;
create trigger trg_contactos_prospecto_mismo_agente
  before insert or update of prospecto_id, agente_id on public.abordaje_prospecto_contactos
  for each row execute function private.check_prospecto_mismo_agente();
