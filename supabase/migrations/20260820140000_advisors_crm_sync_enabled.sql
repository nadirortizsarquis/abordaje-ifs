-- Integración Abordaje -> CRM — flag por asesor "Sincronización con CRM".
-- Ref: PM #819. Controla si un asesor puede usar el botón "Convertir a cliente
-- CRM" (prospectos/tareas/agendas). Default OFF: los asesores que todavía no
-- tienen CRM quedan con el botón inhabilitado. Los admins (Nadir/Federico) están
-- siempre habilitados por rol, independientemente de este flag.
-- Aditivo: columna nueva con default, nada existente cambia.

ALTER TABLE public.advisors
  ADD COLUMN IF NOT EXISTS crm_sync_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.advisors.crm_sync_enabled IS 'Habilita la sincronización con el CRM (botón "Convertir a cliente CRM") para este asesor. Default false. Los admins están habilitados por rol, sin depender de este flag.';
