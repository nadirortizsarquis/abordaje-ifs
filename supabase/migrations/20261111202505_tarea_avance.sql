-- Un avance = una sentencia (MCP: agregar_nota con seguimiento / registrar_avances).
-- Antepone la nota y cambia opcionalmente recordatorio, columna, etiquetas, título, compañía y reunión.
-- Todo o nada; columna ajena -> 'columna_inexistente'. Solo service_role. Ya aplicada.
create or replace function public.abordaje_tarea_avance(
  p_id uuid, p_agente uuid, p_linea text default null,
  p_set_fecha boolean default false, p_fecha date default null,
  p_set_hora boolean default false, p_hora time default null,
  p_columna uuid default null,
  p_etq_agregar text[] default '{}', p_etq_quitar text[] default '{}',
  p_titulo text default null,
  p_set_compania boolean default false, p_compania text default null,
  p_tipo_evento text default null, p_con_meet boolean default null,
  p_invitados text[] default null, p_duracion smallint default null
)
returns setof public.abordaje_tareas
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_columna is not null and not exists (
    select 1 from public.abordaje_tareas_columnas c
     where c.id = p_columna and c.agente_id = p_agente
  ) then
    raise exception 'columna_inexistente' using errcode = 'P0002';
  end if;

  return query
  update public.abordaje_tareas t
     set observacion = case
           when coalesce(btrim(p_linea), '') = '' then t.observacion
           when coalesce(btrim(t.observacion), '') = '' then p_linea
           else p_linea || E'\n\n' || btrim(t.observacion)
         end,
         fecha_recordatorio = case when p_set_fecha then p_fecha else t.fecha_recordatorio end,
         hora_recordatorio  = case when p_set_fecha and p_fecha is null then null
                                   when p_set_hora then p_hora else t.hora_recordatorio end,
         columna_id = coalesce(p_columna, t.columna_id),
         etiquetas = coalesce((
           select (array_agg(e order by primera))[1:10]
             from (select e, min(ord) as primera
                     from unnest(t.etiquetas || coalesce(p_etq_agregar, '{}')) with ordinality as u(e, ord)
                    where not (e = any(coalesce(p_etq_quitar, '{}')))
                    group by e) s
         ), '{}'),
         titulo = coalesce(nullif(btrim(p_titulo), ''), t.titulo),
         compania = case when p_set_compania then p_compania else t.compania end,
         tipo_evento = coalesce(p_tipo_evento, t.tipo_evento),
         con_meet = case when coalesce(p_tipo_evento, t.tipo_evento) <> 'reunion' then false
                         else coalesce(p_con_meet, t.con_meet) end,
         invitados = case when coalesce(p_tipo_evento, t.tipo_evento) <> 'reunion' then '{}'
                          else coalesce(p_invitados, t.invitados) end,
         duracion_min = coalesce(p_duracion, t.duracion_min),
         actor_id = p_agente
   where t.id = p_id and t.agente_id = p_agente
  returning t.*;
end;
$$;
revoke all on function public.abordaje_tarea_avance(uuid, uuid, text, boolean, date, boolean, time, uuid, text[], text[],
  text, boolean, text, text, boolean, text[], smallint) from public, anon, authenticated;
grant execute on function public.abordaje_tarea_avance(uuid, uuid, text, boolean, date, boolean, time, uuid, text[], text[],
  text, boolean, text, text, boolean, text[], smallint) to service_role;
