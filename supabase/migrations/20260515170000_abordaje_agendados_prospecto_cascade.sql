-- Cuando se elimina un prospect, sus agendados deben borrarse también
-- (antes era ON DELETE SET NULL, que dejaba filas huérfanas con prospecto_id
-- = NULL que aparecían como notificaciones fantasmas en piloto).
alter table public.abordaje_agendados
  drop constraint abordaje_agendados_prospecto_id_fkey;

alter table public.abordaje_agendados
  add constraint abordaje_agendados_prospecto_id_fkey
  foreign key (prospecto_id) references public.abordaje_prospectos(id)
  on delete cascade;
