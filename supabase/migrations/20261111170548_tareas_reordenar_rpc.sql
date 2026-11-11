-- reordenar_tarea del MCP en UNA sentencia (code review 11/11): antes renumeraba la
-- columna con un UPDATE por tarea (N idas y vueltas, sin transacción). Recibe los ids
-- en el orden final y asigna orden = posición (0..n-1); solo toca las del agente y
-- las que cambian. Solo service_role (el MCP).
create or replace function public.abordaje_tareas_reordenar(p_agente uuid, p_ids uuid[])
returns integer
language sql
security invoker
set search_path = ''
as $$
  with x as (
    select id, (ord - 1)::double precision as nuevo
    from unnest(p_ids) with ordinality as u(id, ord)
  ), upd as (
    update public.abordaje_tareas t
       set orden = x.nuevo
      from x
     where t.id = x.id
       and t.agente_id = p_agente
       and t.orden is distinct from x.nuevo
    returning 1
  )
  select count(*)::integer from upd;
$$;
revoke all on function public.abordaje_tareas_reordenar(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.abordaje_tareas_reordenar(uuid, uuid[]) to service_role;
