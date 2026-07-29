-- Orden manual + fijado (pin) de las tareas del Kanban.
--   orden      : posición manual dentro de la columna. Se respeta cuando el
--                "Autoordenar por vencimiento" está apagado. null = al final.
--   fijada_at  : timestamp de cuándo se fijó la tarea arriba de su columna.
--                null = no fijada. Las fijadas van siempre arriba, ordenadas
--                por este timestamp (la primera que se fijó, primera arriba),
--                independientemente del autoorden.
-- Ambas columnas son nullable y aditivas: no alteran datos existentes y quedan
-- cubiertas por las policies RLS de UPDATE ya vigentes sobre abordaje_tareas.
ALTER TABLE public.abordaje_tareas
  ADD COLUMN IF NOT EXISTS orden      double precision,
  ADD COLUMN IF NOT EXISTS fijada_at  timestamptz;
