-- Relevamiento de necesidades (formulario 8+1 estilo Life) por prospecto.
-- JSONB con schema versionado en el frontend ({ v: 1, ... }). Nullable:
-- null = nunca se relevó. Viaja con las policies RLS existentes de la tabla.
ALTER TABLE public.abordaje_prospectos ADD COLUMN IF NOT EXISTS relevamiento jsonb;
