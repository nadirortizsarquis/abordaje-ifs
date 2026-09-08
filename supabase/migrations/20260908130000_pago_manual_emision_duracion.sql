-- Calendario de pagos — pagos manuales (IT, etc.): fecha de emisión + duración
-- del plan. Con ambas, el calendario genera las cuotas SOLO dentro de la
-- vigencia [emisión, emisión + duración) en vez de proyectar el vencimiento
-- indefinidamente. Nullables: los registros existentes siguen funcionando
-- como hasta ahora (proyección sin límite anclada al vencimiento).
alter table public.abordaje_pago_manual
  add column if not exists fecha_emision date,
  add column if not exists duracion_anios int check (duracion_anios is null or duracion_anios between 1 and 50);
