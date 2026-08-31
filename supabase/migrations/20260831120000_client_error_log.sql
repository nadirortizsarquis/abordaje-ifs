-- Error tracking en producción: cada error de runtime (ErrorBoundary, window.error,
-- unhandledrejection) se registra acá para tener visibilidad de lo que rompe en la
-- cancha (antes el ErrorBoundary lo tapaba y nadie se enteraba). Baja sensibilidad:
-- solo stack + contexto técnico, sin datos de clientes.
create table if not exists public.abordaje_client_errors (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  email       text,
  app_version text,
  source      text,          -- 'boundary' | 'window' | 'promise'
  message     text,
  stack       text,
  url         text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_client_errors_created on public.abordaje_client_errors (created_at desc);

alter table public.abordaje_client_errors enable row level security;

-- INSERT abierto (anon + authenticated): el logging tiene que funcionar incluso
-- cuando la sesión está rota o el error ocurre en la pantalla de login. App privada
-- de pocos usuarios → el riesgo de spam es despreciable y no justifica gatear el insert.
drop policy if exists client_errors_insert on public.abordaje_client_errors;
create policy client_errors_insert on public.abordaje_client_errors
  for insert to anon, authenticated with check (true);

-- SELECT / DELETE solo admin: los errores los mira/limpia el admin.
drop policy if exists client_errors_select_admin on public.abordaje_client_errors;
create policy client_errors_select_admin on public.abordaje_client_errors
  for select to authenticated using (private.is_admin());

drop policy if exists client_errors_delete_admin on public.abordaje_client_errors;
create policy client_errors_delete_admin on public.abordaje_client_errors
  for delete to authenticated using (private.is_admin());
