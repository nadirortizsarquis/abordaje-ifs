-- Calendario de pagos: campo de observaciones por póliza + permitir fila solo-nota.
-- (El "quién paga" puede quedar sin definir mientras haya una observación cargada.)
alter table public.ole_poliza_pago add column if not exists observaciones text;
alter table public.ole_poliza_pago alter column paga drop not null;
