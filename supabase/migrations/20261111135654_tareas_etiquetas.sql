-- Etiquetas de tareas como campo propio (antes: línea "ETIQUETA: X" en la observación).
-- Aditiva: columna nueva con default (instantánea, no reescribe la tabla). Las
-- políticas RLS de abordaje_tareas son por fila, así que ya cubren la columna.
-- El pase de los datos (leer "ETIQUETA: X" de la nota, cargarlo acá y limpiar esa
-- línea) se hace aparte, recién cuando Abordaje y Universo muestran los chips.
alter table public.abordaje_tareas
  add column if not exists etiquetas text[] not null default '{}';

comment on column public.abordaje_tareas.etiquetas is
  'Etiquetas libres de la tarea (MAYÚSCULAS, sin duplicados). Ej: {BAJA, MANU TORRES}.';
