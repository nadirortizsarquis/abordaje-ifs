-- Integración Abordaje -> CRM IFS Broker (bitácora de clientes) — Fase 1.
-- Base aditiva para vincular un prospecto de Abordaje con un cliente del CRM
-- de Bruno y trackear qué gestión ya se volcó a su bitácora (idempotencia).
--
-- Ref: docs/INTEGRACION_CRM.md · PM tarea #819 (proyecto Abordaje).
--
-- TODO es aditivo y no rompe nada:
--   - Columnas nuevas nullable (salvo `documento`, que va con default '').
--   - Ninguna política RLS cambia: el volcado a bitácora lo hace una Edge
--     Function con service-role (bypassa RLS); el asesor solo edita `documento`
--     y `crm_client_id` de sus propias filas por las policies UPDATE ya existentes.
--   - Los ids del CRM son enteros (PK Django) -> bigint.
--
-- Modelo de vínculo (fuente de verdad de "qué mandé" = lado Abordaje):
--   * abordaje_prospectos.crm_client_id  -> a qué cliente del CRM apunta (fijo una vez linkeado)
--   * <tabla_fuente>.crm_log_id          -> id de la entrada ClientLog creada en el CRM
--   * <tabla_fuente>.crm_synced_at       -> cuándo se sincronizó (NULL = pendiente de enviar)

-- 1) Prospecto: documento (DNI capturado en el modal) + vínculo al cliente CRM.
ALTER TABLE public.abordaje_prospectos
  ADD COLUMN IF NOT EXISTS documento text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS crm_client_id bigint,
  ADD COLUMN IF NOT EXISTS crm_linked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS crm_linked_by uuid;

-- Buscar/deduplicar prospectos por documento dentro del workspace del agente.
CREATE INDEX IF NOT EXISTS idx_abordaje_prospectos_agente_documento
  ON public.abordaje_prospectos (agente_id, documento)
  WHERE documento <> '';

-- Prospectos ya vinculados a un cliente del CRM (para detectar duplicados que
-- apunten al mismo crm_client_id y para el estado del botón).
CREATE INDEX IF NOT EXISTS idx_abordaje_prospectos_crm_client
  ON public.abordaje_prospectos (crm_client_id)
  WHERE crm_client_id IS NOT NULL;

-- 2) Tracking de sync por ítem en las tres tablas-fuente de gestión.
--    crm_synced_at NULL = todavía no volcado a la bitácora del CRM.

ALTER TABLE public.abordaje_prospecto_contactos
  ADD COLUMN IF NOT EXISTS crm_log_id bigint,
  ADD COLUMN IF NOT EXISTS crm_synced_at timestamp with time zone;

ALTER TABLE public.abordaje_agendados
  ADD COLUMN IF NOT EXISTS crm_log_id bigint,
  ADD COLUMN IF NOT EXISTS crm_synced_at timestamp with time zone;

ALTER TABLE public.abordaje_tareas
  ADD COLUMN IF NOT EXISTS crm_log_id bigint,
  ADD COLUMN IF NOT EXISTS crm_synced_at timestamp with time zone;

-- Índices parciales para el path de la Edge Function: "ítems pendientes de
-- enviar de este prospecto" (crm_synced_at IS NULL). No se inflan con lo ya
-- sincronizado.
CREATE INDEX IF NOT EXISTS idx_abordaje_contactos_pendiente_sync
  ON public.abordaje_prospecto_contactos (prospecto_id)
  WHERE crm_synced_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_abordaje_agendados_pendiente_sync
  ON public.abordaje_agendados (prospecto_id)
  WHERE crm_synced_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_abordaje_tareas_pendiente_sync
  ON public.abordaje_tareas (prospecto_id)
  WHERE crm_synced_at IS NULL;

-- Documentación inline (aparece en el catálogo de Postgres / Studio).
COMMENT ON COLUMN public.abordaje_prospectos.documento IS 'DNI/documento capturado para match con el CRM. Texto libre (puede llevar guiones). El prospecto no tenía este dato antes de la integración CRM.';
COMMENT ON COLUMN public.abordaje_prospectos.crm_client_id IS 'Cliente del CRM (ifs-broker) al que quedó vinculado este prospecto. NULL = sin vincular. Se fija una vez y todo el volcado posterior va a este id.';
COMMENT ON COLUMN public.abordaje_prospectos.crm_linked_at IS 'Cuándo se fijó el vínculo con el cliente del CRM.';
COMMENT ON COLUMN public.abordaje_prospectos.crm_linked_by IS 'auth.uid() del asesor que confirmó el vínculo con el CRM.';
COMMENT ON COLUMN public.abordaje_prospecto_contactos.crm_log_id IS 'id de la entrada ClientLog creada en el CRM para esta gestión. NULL = no volcada.';
COMMENT ON COLUMN public.abordaje_prospecto_contactos.crm_synced_at IS 'Cuándo se volcó esta gestión a la bitácora del CRM. NULL = pendiente de enviar.';
COMMENT ON COLUMN public.abordaje_agendados.crm_log_id IS 'id de la entrada ClientLog creada en el CRM para esta agenda. NULL = no volcada.';
COMMENT ON COLUMN public.abordaje_agendados.crm_synced_at IS 'Cuándo se volcó esta agenda a la bitácora del CRM. NULL = pendiente de enviar.';
COMMENT ON COLUMN public.abordaje_tareas.crm_log_id IS 'id de la entrada ClientLog creada en el CRM para esta tarea. NULL = no volcada.';
COMMENT ON COLUMN public.abordaje_tareas.crm_synced_at IS 'Cuándo se volcó esta tarea a la bitácora del CRM. NULL = pendiente de enviar.';
