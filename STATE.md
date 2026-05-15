# Planificador de Abordaje IFS — Estado actual

Estado vigente al 2026-05-15. Para la historia completa del proyecto y las
fases de migración ver `CHANGELOG.md`.

## Stack
- **Frontend**: single-file `index.html` con React 18 (CDN) + Babel
  standalone. Sin build (solo `npm run build` copia el HTML a `public/`).
- **Backend**: Supabase (Postgres + RLS + Edge Functions + Auth).
- **Calendar**: Google Calendar como fuente única para users que activan
  `gcal_enabled`. Domain-Wide Delegation para `@ifs-broker.com`, OAuth
  user-level para gmail externos.
- **Deploy**: Railway, auto-deploy en push a `main` del repo
  `nadirortizsarquis/abordaje-ifs`.

## Features activas
- Lista de abordaje (prospectos) con filtros por estado y fecha.
- Etiquetas de gestión (llamar en 15min, mensaje, agendado, etc.).
- Tareas Kanban con drag & drop (long-press en mobile).
- Calendario Mes / Semana / Hoy con drag & drop, overlap visual, tooltip,
  click derecho para colores custom (paleta de 8 colores, override local).
- Notificaciones (campanita) con clasificación por urgencia.
- Google Calendar opcional por user (toggle en Ajustes), opt-in.
- Buscador global (header) que cubre prospectos, tareas, agendas locales
  y eventos de Google Calendar (rango -3m / +12m).
- Modal de Instrucciones (header) con 9 secciones colapsables.
- Refresh silencioso al cambiar de tab.

## Modelo de asistentes
- `profiles.assistant_of_id` apunta al principal.
- Asistente opera sobre el workspace del principal (mismas tablas,
  mismos datos).
- `actor_id` en entidades operables marca quién hizo cada cambio.
- ActorStar (★ amarillo) en cards/timeline/calendar muestra cuando el
  último que tocó fue distinto al dueño del workspace. Tooltip "Modificado
  por NOMBRE · DD/MM HH:MM".
- `profiles.shares_calendar_with_assistant` controla si el asistente
  puede operar también sobre el Google Calendar personal del principal.

## Edge Functions
| Función | Versión | Propósito |
|---|---|---|
| `gcal-events` | v11 | Calendar de Google (list/create/update/delete/listCalendars/unlink). Soporta DWD, OAuth user-level y modo asistente. |
| `gcal-oauth-init` | v1 | Inicia flujo OAuth para gmail externos. Firma state con HMAC. |
| `gcal-oauth-callback` | v1 | Recibe code de Google, guarda refresh_token, redirige a la app. |
| `create-user` | v9 | Alta de usuarios (admin). |
| `delete-user` | v7 | Baja de usuarios (megaadmin only). |
| `update-user-email` | v4 | Cambio de email (admin). |
| `update-user-password` | v6 | Cambio de password (admin). |

Las 4 funciones de gestión de usuarios comparten `_shared/admin-auth.ts`.

## Seguridad / RLS
- `profiles.update_own_metadata` con WITH CHECK que bloquea cambios
  desde update propio a: `role`, `assistant_of_id`, `email`. Solo los
  campos no sensibles son mutables.
- DELETE en `profiles` no tiene policy: el único path es la edge
  function `delete-user` (megaadmin only via `MEGAADMIN_EMAIL` hardcodeado).
- `user_google_tokens` tiene RLS habilitada **sin policies**: solo
  service_role la toca, los refresh_tokens viven aislados.
- `private.is_admin()` y `private.is_assistant_of(target_id)` son
  helpers SECURITY DEFINER.

## Estructura de tablas (lado Abordaje)
- `profiles` — perfil de usuario
- `user_google_tokens` — refresh_token OAuth
- `abordaje_prospectos`
- `abordaje_prospecto_contactos` (historial de gestiones)
- `abordaje_tareas` + `abordaje_tareas_columnas`
- `abordaje_agendados` (legacy, solo non-piloto)
- `abordaje_event_colors` (overrides visuales del calendar)

Todas (excepto `user_google_tokens`) tienen RLS con policies
agente/admin/asistente.

## Pendientes (auditoría — backlog)
**BAJA prioridad**:
- Accesibilidad: modales sin `role="dialog"`, inputs sin labels asociados.
- Constantes mágicas duplicadas (`max-width: 1520px` en CSS, `MEGAADMIN_EMAIL`
  en frontend y edge function).
- `loadState` trae `select('*')` en cada cambio de tab.
- `actorMap` carga todos los profiles en cada login.
- `App` component con 1197 líneas, candidato a partir en custom hooks.
- `UsuariosSection` con 385 líneas.

**No urgente**:
- Comentarios de autoría dentro de observaciones (texto plano → tabla de
  comentarios con autor/timestamp). Fase 3D conceptual.
- Managers/niveles jerárquicos. Descartado por riesgo de filtración RLS.

## Cómo retomar en otra sesión
1. Leé este STATE.md primero.
2. Para detalle histórico de cada fase, `CHANGELOG.md`.
3. El index.html del frontend es la única fuente del cliente.
4. Las edge functions live en Supabase remoto; se gestionan via MCP o
   `supabase functions deploy`.
5. Migrations recientes en `supabase/migrations/` (las viejas viven solo
   en el remoto de Supabase).
