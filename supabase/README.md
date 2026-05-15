# Supabase — Proyecto Abordaje

## Migrations
Las migrations completas del proyecto Supabase (incluyen schema de Comisiones,
Cotizador Patrimoniales y Abordaje) viven en producción en
`hxjpnekzncqepbhpdkfv.supabase.co` y se pueden listar con la CLI:

```bash
supabase migration list
```

En este folder (`supabase/migrations/`) dejamos solo las migrations
**específicas de Abordaje** aplicadas a partir de Fase 3 (asistentes y
endurecimiento de seguridad). Las migrations anteriores (Fase 1 calendar,
Fase 2 OAuth, etc.) están aplicadas en producción y trackeadas en Supabase,
pero no estaban guardadas localmente; el rastro histórico está en
`NOTAS-GCAL-REFACTOR.md`.

## Convención
Las nuevas migrations se agregan acá nombradas con el timestamp UTC seguido
de un slug descriptivo, ej: `20260515125007_abordaje_indices_y_fks_actor.sql`.

Para aplicar manualmente desde la CLI:
```bash
supabase db push
```

O aplicar via MCP en una nueva sesión:
```
mcp__supabase__apply_migration name=<slug> query=<sql>
```

## Edge functions
Las edge functions live en `supabase/functions/` dentro del proyecto Supabase
remoto. No están versionadas localmente; se gestionan via MCP o CLI:

- `gcal-events` (v11) — Calendar de Google (DWD para Workspace + OAuth
  para gmail externo + soporte de asistente)
- `gcal-oauth-init` (v1) — Inicia flujo OAuth user-level
- `gcal-oauth-callback` (v1) — Recibe el callback de Google y guarda
  refresh_token
- `create-user` (v9) — Alta de usuarios (admin)
- `delete-user` (v7) — Baja de usuarios (megaadmin)
- `update-user-email` (v4) — Cambio de email (admin)
- `update-user-password` (v6) — Cambio de password (admin)

Las 4 últimas comparten `_shared/admin-auth.ts` con el helper `requireAdmin()`.

## Schema overview (lado Abordaje)
Tablas en `public`:
- `profiles` — perfil de usuario (id, email, display_name, role,
  advisor_name_ole, abordaje_settings, gcal_enabled, assistant_of_id,
  shares_calendar_with_assistant)
- `user_google_tokens` — refresh_token de OAuth user-level (RLS sin
  policies; solo service_role lo toca)
- `abordaje_prospectos` — pool de prospectos
- `abordaje_prospecto_contactos` — historial de gestiones / etiquetas
- `abordaje_tareas` — kanban
- `abordaje_tareas_columnas` — columnas del kanban
- `abordaje_agendados` — agendas standalone (solo para users non-piloto)
- `abordaje_event_colors` — overrides de color del calendar (click derecho)

Funciones helper en schema `private`:
- `private.is_admin()` — caller tiene `role='admin'`
- `private.is_assistant_of(target_id uuid)` — caller es asistente del target

Policies clave en `profiles`:
- `profiles_select` — todos pueden leer su propio profile, admin ve todos,
  asistentes ven a su principal
- `update_own_metadata` — un user actualiza su propio profile pero
  inmutable en `role`, `assistant_of_id`, `email`
- `admin_select_all` / `admin_insert` / `admin_update` — admin tiene
  estos tres; DELETE intencionalmente NO está como policy: el único path
  es la edge function `delete-user` (megaadmin only)
