-- ── 1) Índices que faltaban ─────────────────────────────
-- profiles.assistant_of_id: se filtra en cada policy (private.is_assistant_of).
-- Partial index porque la columna es NULL para casi todos los profiles.
create index if not exists profiles_assistant_of_id_idx
  on public.profiles (assistant_of_id)
  where assistant_of_id is not null;

-- abordaje_prospecto_contactos: se filtra por agente_id en loadState pero
-- solo tenía idx por prospecto_id.
create index if not exists abordaje_prospecto_contactos_agente_id_idx
  on public.abordaje_prospecto_contactos (agente_id);

-- ── 2) FKs en actor_id con ON DELETE SET NULL ───────────
-- Si un user se borra, su actor_id en filas existentes pasa a NULL en lugar
-- de quedar dangling. NOT VALID + VALIDATE para evitar lockear la tabla.

alter table public.abordaje_prospectos
  add constraint abordaje_prospectos_actor_fk
  foreign key (actor_id) references public.profiles(id) on delete set null
  not valid;
alter table public.abordaje_prospectos validate constraint abordaje_prospectos_actor_fk;

alter table public.abordaje_prospecto_contactos
  add constraint abordaje_prospecto_contactos_actor_fk
  foreign key (actor_id) references public.profiles(id) on delete set null
  not valid;
alter table public.abordaje_prospecto_contactos validate constraint abordaje_prospecto_contactos_actor_fk;

alter table public.abordaje_tareas
  add constraint abordaje_tareas_actor_fk
  foreign key (actor_id) references public.profiles(id) on delete set null
  not valid;
alter table public.abordaje_tareas validate constraint abordaje_tareas_actor_fk;

alter table public.abordaje_agendados
  add constraint abordaje_agendados_actor_fk
  foreign key (actor_id) references public.profiles(id) on delete set null
  not valid;
alter table public.abordaje_agendados validate constraint abordaje_agendados_actor_fk;

-- ── 3) Constraint estado_check con 'programado' ───────
-- Las etiquetas "Llamar semana próx", "Fecha exacta", "Llamar dentro de…"
-- mapean a estado='programado' que faltaba en el check original.
alter table public.abordaje_prospectos drop constraint if exists abordaje_prospectos_estado_check;
alter table public.abordaje_prospectos add constraint abordaje_prospectos_estado_check
  check (estado = any (array['nuevo','pendiente','programado','largo-plazo','agendado','rechazado']));
