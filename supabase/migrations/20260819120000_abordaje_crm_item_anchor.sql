-- Integración Abordaje -> CRM — Fase 1b: ancla por cliente a nivel ítem.
-- Ref: docs/INTEGRACION_CRM.md · PM #819 (opción B, ancla en el cliente del CRM).
--
-- Muchas tareas/agendas se crean SIN prospecto en Lista de Abordaje. Para poder
-- vincularlas al CRM y volcarlas a la bitácora sin forzar la creación de un
-- prospecto, guardamos el vínculo (crm_client_id) también a nivel ítem.
--
-- Resolución del cliente efectivo de un ítem:
--   tarea/agenda con prospecto  -> el vínculo canónico vive en el prospecto
--   tarea/agenda suelta         -> el vínculo vive en la propia fila (estas columnas)
-- El `sync` junta TODO lo que apunte al mismo crm_client_id (lo del prospecto +
-- esa tarea + esa agenda), de ahí "traer la info de todos lados".
--
-- Aditivo puro: columnas nullable, ningún dato existente cambia, RLS intacta.

ALTER TABLE public.abordaje_tareas
  ADD COLUMN IF NOT EXISTS crm_client_id bigint,
  ADD COLUMN IF NOT EXISTS crm_linked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS crm_linked_by uuid;

ALTER TABLE public.abordaje_agendados
  ADD COLUMN IF NOT EXISTS crm_client_id bigint,
  ADD COLUMN IF NOT EXISTS crm_linked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS crm_linked_by uuid;

-- Ítems sueltos vinculados a un cliente del CRM (para resolver el scope del sync
-- por cliente y el estado del botón). Parciales: no se inflan con lo no vinculado.
CREATE INDEX IF NOT EXISTS idx_abordaje_tareas_crm_client
  ON public.abordaje_tareas (crm_client_id)
  WHERE crm_client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_abordaje_agendados_crm_client
  ON public.abordaje_agendados (crm_client_id)
  WHERE crm_client_id IS NOT NULL;

COMMENT ON COLUMN public.abordaje_tareas.crm_client_id IS 'Cliente del CRM vinculado directamente a esta tarea (solo tareas sueltas sin prospecto; si la tarea tiene prospecto, el vínculo canónico vive en el prospecto). NULL = sin vincular a nivel ítem.';
COMMENT ON COLUMN public.abordaje_tareas.crm_linked_at IS 'Cuándo se vinculó esta tarea suelta a un cliente del CRM.';
COMMENT ON COLUMN public.abordaje_tareas.crm_linked_by IS 'auth.uid() del asesor que vinculó esta tarea al CRM.';
COMMENT ON COLUMN public.abordaje_agendados.crm_client_id IS 'Cliente del CRM vinculado directamente a esta agenda (solo agendas sueltas sin prospecto). NULL = sin vincular a nivel ítem.';
COMMENT ON COLUMN public.abordaje_agendados.crm_linked_at IS 'Cuándo se vinculó esta agenda suelta a un cliente del CRM.';
COMMENT ON COLUMN public.abordaje_agendados.crm_linked_by IS 'auth.uid() del asesor que vinculó esta agenda al CRM.';
