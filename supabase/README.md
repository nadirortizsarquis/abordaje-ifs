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
pero no están guardadas localmente como archivos individuales. Para poder
reconstruir el schema completo sin esa historia, existe
`supabase/schema_baseline.sql` — dump schema-only de `public`, `private`,
`comisiones` y `patrimoniales` tomado el 2026-06-11 (regenerar con
`pg_dump --schema-only`, ver `scripts/backup-db.sh` para la conexión).

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
Desde 2026-06-11 el código fuente está **versionado en este repo** en
`supabase/functions/<slug>/` (descargado del remoto, idéntico a producción).
Convención: toda modificación se hace sobre el archivo local y se deploya
(`supabase functions deploy <slug>` o MCP `deploy_edge_function`) — nunca
editar solo el remoto.

Funciones activas (versión de deploy al 2026-06-11):

- `gcal-events` (v12, JWT) — Calendar de Google (DWD para Workspace + OAuth
  para gmail externo + soporte de asistente)
- `gcal-events-admin` (v2, sin JWT — auth por service-role en header) —
  acceso admin al calendar de cualquier user, pensada para el MCP/Claude
- `gcal-oauth-init` (v2, JWT) — Inicia flujo OAuth user-level
- `gcal-oauth-callback` (v2, sin JWT) — Recibe el callback de Google y
  guarda refresh_token
- `create-user` (v10, JWT) — Alta de usuarios (admin)
- `delete-user` (v8, JWT) — Baja de usuarios (megaadmin)
- `update-user-email` (v5, JWT) — Cambio de email (admin)
- `update-user-password` (v7, JWT) — Cambio de password (admin)

Las 4 de gestión de usuarios comparten `_shared/admin-auth.ts` con el helper
`requireAdmin()` (cada función lleva su copia en `<slug>/_shared/` porque el
import es relativo `./_shared/`; si se modifica, replicar en las 4).

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
