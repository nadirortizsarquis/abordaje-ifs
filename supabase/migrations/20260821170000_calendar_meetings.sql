-- Calendarios compartidos — Parte 2: eventos/reuniones con invitaciones.
-- Un "evento compartido" (meeting) lo crea un agente desde la vista Calendario
-- compartido (o al invitar desde su calendario normal). A diferencia de los
-- bloques ocupado/disponible (anonimizados), estos SI muestran título a quienes
-- participan (creador + invitados). Vive 100% en Abordaje (no toca Google).
--
-- Modelo:
--   abordaje_calendar_meetings          -> el evento (creador, título, horario).
--     creator_agenda = el creador lo quiere en su propio calendario de Abordaje.
--   abordaje_calendar_meeting_invites   -> a quién invitó + su respuesta.
--     status: pending | accepted | declined. Al aceptar, el invitado lo ve en su
--     propio calendario de Abordaje (render-only, no crea evento en Google).
--
-- Nada existente cambia (tablas nuevas + RLS propia).

create table if not exists public.abordaje_calendar_meetings (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  notes text,
  creator_agenda boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists idx_cal_meetings_creator on public.abordaje_calendar_meetings (creator_id);
create index if not exists idx_cal_meetings_start on public.abordaje_calendar_meetings (start_at);

create table if not exists public.abordaje_calendar_meeting_invites (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.abordaje_calendar_meetings(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (meeting_id, invitee_id)
);
create index if not exists idx_cal_invites_invitee on public.abordaje_calendar_meeting_invites (invitee_id, status);
create index if not exists idx_cal_invites_meeting on public.abordaje_calendar_meeting_invites (meeting_id);

alter table public.abordaje_calendar_meetings enable row level security;
alter table public.abordaje_calendar_meeting_invites enable row level security;

-- Helpers SECURITY DEFINER (evitan recursión de policies entre las dos tablas).
create or replace function private.can_see_meeting(m_id uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.abordaje_calendar_meetings m where m.id = m_id and m.creator_id = auth.uid())
      or exists (select 1 from public.abordaje_calendar_meeting_invites i where i.meeting_id = m_id and i.invitee_id = auth.uid());
$$;

create or replace function private.is_meeting_creator(m_id uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.abordaje_calendar_meetings m where m.id = m_id and m.creator_id = auth.uid());
$$;

-- Meetings: ve el creador + los invitados; escribe/edita/borra solo el creador.
create policy meetings_select on public.abordaje_calendar_meetings
  for select using (private.can_see_meeting(id));
create policy meetings_insert on public.abordaje_calendar_meetings
  for insert with check (creator_id = (select auth.uid()));
create policy meetings_update on public.abordaje_calendar_meetings
  for update using (creator_id = (select auth.uid())) with check (creator_id = (select auth.uid()));
create policy meetings_delete on public.abordaje_calendar_meetings
  for delete using (creator_id = (select auth.uid()));

-- Invites: ve el invitado (el suyo) y el creador (todos los de su meeting).
create policy invites_select on public.abordaje_calendar_meeting_invites
  for select using (invitee_id = (select auth.uid()) or private.is_meeting_creator(meeting_id));
-- Solo el creador del meeting agrega invitados.
create policy invites_insert on public.abordaje_calendar_meeting_invites
  for insert with check (private.is_meeting_creator(meeting_id));
-- El invitado responde su propia invitación (accepted/declined).
create policy invites_update on public.abordaje_calendar_meeting_invites
  for update using (invitee_id = (select auth.uid())) with check (invitee_id = (select auth.uid()));
-- Borra el invitado (el suyo) o el creador (para desinvitar).
create policy invites_delete on public.abordaje_calendar_meeting_invites
  for delete using (invitee_id = (select auth.uid()) or private.is_meeting_creator(meeting_id));

revoke all on function private.can_see_meeting(uuid) from public, anon;
revoke all on function private.is_meeting_creator(uuid) from public, anon;
grant execute on function private.can_see_meeting(uuid) to authenticated;
grant execute on function private.is_meeting_creator(uuid) to authenticated;
