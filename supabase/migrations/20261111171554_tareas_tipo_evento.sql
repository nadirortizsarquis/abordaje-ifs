-- Calendar sin duplicados (docs/CALENDAR_SIN_DUPLICADOS.md), paso 1.
-- Cada tarjeta tiene UN solo evento en Google. Estos campos describen ese evento;
-- las edge functions (gcal-events / gcal-events-admin) los aplican al crear o
-- actualizar el evento de una tarjeta, venga el pedido de la app, de Universo o del MCP.
--   tipo_evento  'recordatorio' (default, lila) | 'reunion' (azul, puede llevar Meet e invitados)
--   con_meet     la reunión lleva Google Meet
--   invitados    emails a invitar (solo reuniones)
--   duracion_min duración del evento (antes fija en 60)
alter table public.abordaje_tareas
  add column if not exists tipo_evento text not null default 'recordatorio',
  add column if not exists con_meet boolean not null default false,
  add column if not exists invitados text[] not null default '{}',
  add column if not exists duracion_min smallint not null default 60;

alter table public.abordaje_tareas
  drop constraint if exists abordaje_tareas_tipo_evento_check,
  add constraint abordaje_tareas_tipo_evento_check check (tipo_evento in ('recordatorio', 'reunion')),
  drop constraint if exists abordaje_tareas_duracion_min_check,
  add constraint abordaje_tareas_duracion_min_check check (duracion_min between 5 and 1440),
  drop constraint if exists abordaje_tareas_invitados_check,
  add constraint abordaje_tareas_invitados_check check (cardinality(invitados) <= 20);

-- Calendario donde se crean los eventos de cada agente (null = el principal de su cuenta).
alter table public.profiles add column if not exists gcal_calendar_id text;

-- El reconciliador también tiene que enterarse si estos campos cambian por fuera de las apps.
create or replace function private.tareas_gcal_marcar()
returns trigger
language plpgsql
set search_path to ''
as $function$
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
        new.archivada, new.prospecto_id,
        new.tipo_evento, new.con_meet, new.invitados, new.duracion_min)
       is distinct from
       (old.titulo, old.fecha_recordatorio, old.hora_recordatorio, old.observacion,
        old.archivada, old.prospecto_id,
        old.tipo_evento, old.con_meet, old.invitados, old.duracion_min) then
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
$function$;
