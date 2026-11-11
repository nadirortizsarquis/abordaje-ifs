-- Sync de Google Calendar para cambios de tareas hechos FUERA de las apps
-- (SQL directo, migraciones, scripts como postgres). Aditiva.
--
-- Quién sincroniza qué:
--   * Abordaje / Universo (rol `authenticated`) y el MCP (rol `service_role`) ya
--     crean/actualizan/borran el evento de Google ellos mismos → el trigger NO los marca.
--   * Cualquier otro rol (postgres, supabase_admin: SQL editor, execute_sql, migraciones)
--     → la tarea queda `gcal_pendiente = true` y el reconciliador del MCP (job cada
--     5 min en Railway) crea / actualiza / borra el evento y limpia la marca.
--   * Tarea borrada por SQL que tenía evento → su event_id va a la cola
--     `abordaje_gcal_borrar` y el reconciliador lo borra de Google.
-- Funciones SECURITY INVOKER a propósito: con DEFINER, current_user sería el dueño
-- y no se podría distinguir quién hizo el cambio.

alter table public.abordaje_tareas
  add column if not exists gcal_pendiente boolean not null default false;

create index if not exists abordaje_tareas_gcal_pendiente_idx
  on public.abordaje_tareas (updated_at) where gcal_pendiente;

create table if not exists public.abordaje_gcal_borrar (
  id bigint generated always as identity primary key,
  agente_id uuid not null,
  event_id text not null,
  created_at timestamptz not null default now()
);
-- RLS sin políticas: solo service_role (que la saltea) la lee/escribe.
alter table public.abordaje_gcal_borrar enable row level security;
revoke all on public.abordaje_gcal_borrar from anon, authenticated;

create or replace function private.tareas_gcal_marcar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'service_role', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.fecha_recordatorio is not null and not coalesce(new.archivada, false) then
      new.gcal_pendiente := true;
    end if;
  elsif (new.titulo, new.fecha_recordatorio, new.hora_recordatorio, new.observacion, new.archivada)
        is distinct from
        (old.titulo, old.fecha_recordatorio, old.hora_recordatorio, old.observacion, old.archivada)
    and (new.fecha_recordatorio is not null or old.google_event_id is not null) then
    new.gcal_pendiente := true;
  end if;
  return new;
end;
$$;

create or replace function private.tareas_gcal_borrado()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'service_role', 'anon')
     and old.google_event_id is not null then
    insert into public.abordaje_gcal_borrar (agente_id, event_id)
    values (old.agente_id, old.google_event_id);
  end if;
  return old;
end;
$$;

drop trigger if exists tareas_gcal_marcar on public.abordaje_tareas;
create trigger tareas_gcal_marcar
  before insert or update on public.abordaje_tareas
  for each row execute function private.tareas_gcal_marcar();

drop trigger if exists tareas_gcal_borrado on public.abordaje_tareas;
create trigger tareas_gcal_borrado
  after delete on public.abordaje_tareas
  for each row execute function private.tareas_gcal_borrado();
