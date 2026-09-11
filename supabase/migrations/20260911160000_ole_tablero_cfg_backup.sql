-- Backup en la nube del config del Tablero OLE (aplicada via MCP 2026-09-11).
-- Protege contra perdida por cuota de localStorage / navegador limpiado / otro equipo.
create table if not exists public.ole_tablero_cfg (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  cfg       jsonb not null,
  client_ts bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.ole_tablero_cfg enable row level security;
drop policy if exists ole_cfg_select on public.ole_tablero_cfg;
create policy ole_cfg_select on public.ole_tablero_cfg for select using ((select auth.uid()) = user_id);
drop policy if exists ole_cfg_upsert on public.ole_tablero_cfg;
create policy ole_cfg_upsert on public.ole_tablero_cfg for insert with check ((select auth.uid()) = user_id);
drop policy if exists ole_cfg_update on public.ole_tablero_cfg;
create policy ole_cfg_update on public.ole_tablero_cfg for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
