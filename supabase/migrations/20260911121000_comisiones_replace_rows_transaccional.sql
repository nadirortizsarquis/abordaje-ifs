-- Auditoria Comisiones 2026-09 — Fase 2 (hallazgos 2.2, 3.12)
-- Aplicada en produccion via MCP el 2026-09-11. Espejo versionado.
-- Reemplazo atomico de liquidation_rows / custom_report_rows por usuario.
-- SECURITY INVOKER: la RLS de las tablas sigue mandando.

create or replace function comisiones.replace_liquidation_rows(p_user uuid, p_rows jsonb)
returns integer language plpgsql security invoker set search_path to 'comisiones' as $$
declare v_count integer;
begin
  delete from comisiones.liquidation_rows where user_id = p_user;
  insert into comisiones.liquidation_rows
    (user_id, asesor, poliza, propietario, frecuencia, tipo_negocio, producto,
     asesor_sup, id_asesor, periodo_n, periodo_m, fecha_efectiva, fecha_pago,
     comision, comision_cobertura, comision_ingresos, comision_ec,
     comision_cancer, pct_cobertura, tipo_tx, filename)
  select p_user, r.asesor, r.poliza, r.propietario, r.frecuencia, r.tipo_negocio,
         r.producto, r.asesor_sup, r.id_asesor, r.periodo_n, r.periodo_m,
         r.fecha_efectiva, r.fecha_pago, r.comision, r.comision_cobertura,
         r.comision_ingresos, r.comision_ec, r.comision_cancer, r.pct_cobertura,
         r.tipo_tx, r.filename
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    asesor text, poliza text, propietario text, frecuencia text,
    tipo_negocio text, producto text, asesor_sup text, id_asesor text,
    periodo_n integer, periodo_m integer, fecha_efectiva date, fecha_pago date,
    comision numeric, comision_cobertura numeric, comision_ingresos numeric,
    comision_ec numeric, comision_cancer numeric, pct_cobertura numeric,
    tipo_tx text, filename text);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

create or replace function comisiones.replace_custom_rows(p_user uuid, p_rows jsonb)
returns integer language plpgsql security invoker set search_path to 'comisiones' as $$
declare v_count integer;
begin
  delete from comisiones.custom_report_rows where user_id = p_user;
  insert into comisiones.custom_report_rows
    (user_id, poliza, asesor, prima_anual, fecha_efectivo, status, filename)
  select p_user, r.poliza, r.asesor, r.prima_anual, r.fecha_efectivo, r.status, r.filename
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    poliza text, asesor text, prima_anual numeric, fecha_efectivo date,
    status text, filename text);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

revoke execute on function comisiones.replace_liquidation_rows(uuid, jsonb) from public, anon;
revoke execute on function comisiones.replace_custom_rows(uuid, jsonb) from public, anon;
grant execute on function comisiones.replace_liquidation_rows(uuid, jsonb) to authenticated;
grant execute on function comisiones.replace_custom_rows(uuid, jsonb) to authenticated;
