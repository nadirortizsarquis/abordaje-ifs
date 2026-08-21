-- RPC para setear profiles.compartir_calendario sin gatillar la recursión de la
-- RLS de profiles. El UPDATE directo desde el cliente hace evaluar la policy
-- update_own_metadata, cuyo WITH CHECK tiene subqueries a profiles que recursan
-- (42P17). SECURITY DEFINER corre como owner (bypass RLS) -> sin recursión.
-- Autorización explícita adentro: admin puede setear a cualquiera; cada uno el suyo.
create or replace function public.set_compartir_calendario(target_id uuid, val boolean)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not (private.is_admin() or target_id = auth.uid()) then
    raise exception 'no autorizado para cambiar compartir_calendario';
  end if;
  update public.profiles set compartir_calendario = val where id = target_id;
  return val;
end;
$$;

revoke all on function public.set_compartir_calendario(uuid, boolean) from public, anon;
grant execute on function public.set_compartir_calendario(uuid, boolean) to authenticated;
