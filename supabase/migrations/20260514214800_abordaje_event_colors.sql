-- Overrides de color para eventos del calendar (click derecho sobre tarjeta).
-- event_key formato: "prospecto:UUID" | "tarea:UUID" | "agenda:UUID" | "gcal:GID"
-- color: id de paleta ("rojo", "verde", etc.)
create table public.abordaje_event_colors (
  id uuid primary key default gen_random_uuid(),
  agente_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  color text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agente_id, event_key)
);

alter table public.abordaje_event_colors enable row level security;

create policy event_colors_select on public.abordaje_event_colors
  for select using (
    agente_id = auth.uid()
    or private.is_admin()
    or private.is_assistant_of(agente_id)
  );

create policy event_colors_insert on public.abordaje_event_colors
  for insert with check (
    agente_id = auth.uid()
    or private.is_admin()
    or private.is_assistant_of(agente_id)
  );

create policy event_colors_update on public.abordaje_event_colors
  for update using (
    agente_id = auth.uid()
    or private.is_admin()
    or private.is_assistant_of(agente_id)
  );

create policy event_colors_delete on public.abordaje_event_colors
  for delete using (
    agente_id = auth.uid()
    or private.is_admin()
    or private.is_assistant_of(agente_id)
  );

create index abordaje_event_colors_agente_idx on public.abordaje_event_colors (agente_id);
