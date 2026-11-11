-- v2 del sync de Google para tareas cambiadas fuera de las apps (code review 11/11).
--
-- 1) Señal de origen: session_user en vez de current_user. Las apps, el MCP y las
--    edge functions entran por PostgREST como `authenticator` (después SET ROLE);
--    Auth como `supabase_auth_admin`. session_user no cambia con SET ROLE ni con las
--    cascadas de FK (que corren como dueño de la tabla), así que un borrado de
--    prospecto hecho desde la app ya no encola eventos que la app ya borró.
-- 2) UPDATE solo marca si hay algo que sincronizar: la tarea ya tiene evento y
--    cambió algo visible, o (sin evento) aparece / cambia la fecha o se desarchiva.
--    Editar título/nota de una tarea vieja sin evento NO crea eventos nuevos.
-- 3) Cambio de agente por SQL: el evento viejo va a la cola de borrado (calendario
--    del agente original) y se crea uno nuevo en el del agente nuevo.
-- 4) Contador de intentos (el reconciliador deja de reintentar a los 5).
-- 5) RPC atómica para anteponer una nota (agregar_nota del MCP) sin carrera.

alter table public.abordaje_tareas
  add column if not exists gcal_intentos smallint not null default 0;
alter table public.abordaje_gcal_borrar
  add column if not exists intentos smallint not null default 0;

create or replace function private.tareas_gcal_marcar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if session_user in ('authenticator', 'supabase_auth_admin', 'supabase_storage_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.fecha_recordatorio is not null and not coalesce(new.archivada, false) then
      new.gcal_pendiente := true;
      new.gcal_intentos := 0;
    end if;
    return new;
  end if;

  -- Cambio de agente: el evento vive en el calendario del agente original.
  if new.agente_id is distinct from old.agente_id and old.google_event_id is not null then
    insert into public.abordaje_gcal_borrar (agente_id, event_id)
    values (old.agente_id, old.google_event_id);
    new.google_event_id := null;
    if new.fecha_recordatorio is not null and not coalesce(new.archivada, false) then
      new.gcal_pendiente := true;
      new.gcal_intentos := 0;
    end if;
    return new;
  end if;

  if old.google_event_id is not null then
    if (new.titulo, new.fecha_recordatorio, new.hora_recordatorio, new.observacion,
        new.archivada, new.prospecto_id)
       is distinct from
       (old.titulo, old.fecha_recordatorio, old.hora_recordatorio, old.observacion,
        old.archivada, old.prospecto_id) then
      new.gcal_pendiente := true;
      new.gcal_intentos := 0;
    end if;
  elsif new.fecha_recordatorio is not null and not coalesce(new.archivada, false)
        and (new.fecha_recordatorio, new.hora_recordatorio, new.archivada)
            is distinct from
            (old.fecha_recordatorio, old.hora_recordatorio, old.archivada) then
    new.gcal_pendiente := true;
    new.gcal_intentos := 0;
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
  if session_user not in ('authenticator', 'supabase_auth_admin', 'supabase_storage_admin')
     and old.google_event_id is not null then
    insert into public.abordaje_gcal_borrar (agente_id, event_id)
    values (old.agente_id, old.google_event_id);
  end if;
  return old;
end;
$$;

-- agregar_nota atómico: antepone la línea en la misma sentencia (sin leer-y-escribir
-- desde el cliente, que pisaba una edición simultánea hecha desde la app).
create or replace function public.abordaje_tarea_prepend_nota(p_id uuid, p_agente uuid, p_linea text)
returns setof public.abordaje_tareas
language sql
security invoker
set search_path = ''
as $$
  update public.abordaje_tareas
     set observacion = case
           when coalesce(btrim(observacion), '') = '' then p_linea
           else p_linea || E'\n\n' || btrim(observacion)
         end,
         actor_id = p_agente
   where id = p_id and agente_id = p_agente
  returning *;
$$;
revoke all on function public.abordaje_tarea_prepend_nota(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.abordaje_tarea_prepend_nota(uuid, uuid, text) to service_role;
