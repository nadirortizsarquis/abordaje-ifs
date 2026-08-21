-- Calendarios compartidos (Abordaje) — Parte 1: base de datos.
-- Ref: pedido de Nadir (21/08/2026). Permite que un agente vea los espacios
-- OCUPADO/DISPONIBLE del calendario de otros agentes que lo autorizaron, sin
-- exponer título/asunto (anonimizado server-side). La matriz de autorización la
-- maneja el admin; cada agente tiene un toggle de consentimiento propio.
--
-- Modelo:
--   profiles.compartir_calendario  -> toggle master de cada usuario (consentimiento
--     y opt-in). Si está OFF: no participa (su calendario no se comparte) y no ve
--     la solapa "Calendario compartido".
--   abordaje_calendar_shares(owner_id, viewer_id) -> "owner comparte su calendario
--     con viewer" (lo setea el admin desde la matriz de Ajustes).
--   Para que viewer vea el calendario de owner se requiere: share(owner->viewer) +
--   owner.compartir_calendario=true + viewer.compartir_calendario=true (se valida
--   en la Edge Function, no acá).
--
-- Todo aditivo: columna nueva con default, tabla nueva, RLS propia. Nada existente cambia.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS compartir_calendario boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.compartir_calendario IS 'Consentimiento/opt-in del agente para participar en "Calendario compartido". Si false: su calendario no se comparte y no ve la solapa.';

CREATE TABLE IF NOT EXISTS public.abordaje_calendar_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, viewer_id),
  CHECK (owner_id <> viewer_id)
);

COMMENT ON TABLE public.abordaje_calendar_shares IS 'Matriz de autorización de Calendario compartido: owner comparte su calendario (ocupado/disponible) con viewer. La gestiona el admin.';

CREATE INDEX IF NOT EXISTS idx_cal_shares_viewer ON public.abordaje_calendar_shares (viewer_id);
CREATE INDEX IF NOT EXISTS idx_cal_shares_owner  ON public.abordaje_calendar_shares (owner_id);

ALTER TABLE public.abordaje_calendar_shares ENABLE ROW LEVEL SECURITY;

-- Lectura: cada agente ve las filas donde es owner o viewer (para mostrarlas en
-- Ajustes General); los admins ven todo (para la matriz).
CREATE POLICY cal_shares_select ON public.abordaje_calendar_shares
  FOR SELECT
  USING (owner_id = (SELECT auth.uid()) OR viewer_id = (SELECT auth.uid()) OR (SELECT private.is_admin()));

-- Escritura: solo admins (gestionan la matriz).
CREATE POLICY cal_shares_admin_write ON public.abordaje_calendar_shares
  FOR ALL
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));
