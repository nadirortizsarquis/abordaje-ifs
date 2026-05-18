-- Soporte para archivar tareas: flag archivada (default false). Las tareas
-- archivadas no se ven en el kanban normal pero quedan persistidas y son
-- recuperables desde el buscador global (con el check "Incluir archivadas")
-- o desarchivando desde el modal de edición.
--
-- Índice parcial sobre las no archivadas: el kanban consulta por agente_id +
-- ordena por created_at, y excluye archivadas — este índice cubre ese path
-- sin inflarse con tareas viejas archivadas.

ALTER TABLE public.abordaje_tareas
  ADD COLUMN IF NOT EXISTS archivada boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_abordaje_tareas_agente_no_archivada
  ON public.abordaje_tareas (agente_id, created_at)
  WHERE archivada = false;
