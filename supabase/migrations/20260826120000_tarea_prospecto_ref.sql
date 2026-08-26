-- "Convertir prospecto en tarjeta": link BLANDO de una tarea manual a un prospecto,
-- solo para conservar el historial de abordaje. Es DISTINTO de prospecto_id (que lo
-- maneja el sync de auto-tareas y borra-y-recrea): prospecto_ref_id NO lo toca el
-- sync, así la tarjeta convertida nunca se pisa. on delete set null: si el prospecto
-- se borra, la tarjeta sobrevive (con su snapshot del historial en la nota).
alter table public.abordaje_tareas
  add column if not exists prospecto_ref_id uuid references public.abordaje_prospectos(id) on delete set null;

create index if not exists idx_tareas_prospecto_ref on public.abordaje_tareas (prospecto_ref_id);
