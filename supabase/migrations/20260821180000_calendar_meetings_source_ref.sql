-- Módulo 4: invitar desde el calendario normal. Permite ligar un meeting a un
-- evento origen del calendario (agenda/tarea/prospecto/google) para invitar desde
-- ahí de forma idempotente (no duplicar el meeting si se invita dos veces).
alter table public.abordaje_calendar_meetings add column if not exists source_ref text;
comment on column public.abordaje_calendar_meetings.source_ref is 'Referencia al evento origen desde el que se invitó (ej: agenda:<id>, gcal:<eventId>). NULL = meeting creado directo en Calendario compartido.';
create unique index if not exists uq_cal_meetings_creator_source
  on public.abordaje_calendar_meetings (creator_id, source_ref)
  where source_ref is not null;
