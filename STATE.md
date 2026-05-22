# Planificador de Abordaje IFS — Estado actual

Estado vigente al 2026-05-21. Para la historia completa del proyecto y las
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
- Tareas Kanban con drag & drop (long-press 400ms en mobile, columnas sin
  tope vertical en celular, reorden de columnas con confirmación).
- Calendario Mes / Semana / Hoy con drag & drop, overlap visual, tooltip,
  click derecho para colores custom (paleta de 8 colores, override local).
- Modal específico al clickear evento de prospect en calendar (abrir ficha
  vs eliminar solo del calendar).
- Modal para borrar eventos huérfanos del calendar (sin tener que ir a Google).
- Notificaciones (campanita) con clasificación por urgencia.
- Google Calendar opcional por user (toggle en Ajustes), opt-in.
- Banner sutil "Reconectar Google Calendar" cuando el token expira.
- Buscador global con debounce (200ms) que cubre prospectos, tareas,
  agendas locales, gestiones (observaciones de contactos) y eventos de
  Google Calendar (rango -3m / +12m).
- Modal de Instrucciones (header) con 9 secciones colapsables.
- Refresh silencioso al cambiar de tab (incluye refresh de `principalProfile`
  para asistentes — detectan cambios de share/gcal_enabled del principal).
- Todos los confirm() nativos reemplazados por modales propios coherentes
  con el resto del diseño (eliminar prospect, eliminar tarea, eliminar
  agenda, reordenar columna, agregar columna).
- Footer sticky en todos los modales (Guardar/Cancelar siempre visibles).

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
- `abordaje_tareas` + `abordaje_tareas_columnas` (`actor_id`/`updated_at`
  agregados 2026-05-21)
- `abordaje_agendados` (legacy, solo non-piloto)
- `abordaje_event_colors` (overrides visuales del calendar)
- ~~`calendar_sync_watches`~~ (dropeada 2026-05-21, era legacy del refactor
  viejo y no se usaba en ninguna parte)

Todas (excepto `user_google_tokens`) tienen RLS con policies
agente/admin/asistente.

## Pendientes (auditoría — backlog)
**Sesión 2026-05-21** (ver CHANGELOG.md sección detallada):
- ✓ Críticos resueltos: race condition en `sincronizarSeguimiento` (lock
  por prospectoId), `handleAddContacto` resincroniza siempre,
  `handleConvertirTareaAProspect` borra evento Google, limpieza Google con
  rango amplio (-10/+10 años).
- ✓ Medios resueltos: título de agenda preservado, contacto inicial al
  convertir tarea, modal de eventos huérfanos, `actor_id` en columnas (+
  migration), delete columna limpia gcal, validación de move tarea,
  rollback Google si falla DB, modal de delete agenda con detección de
  recurrentes, `principalProfile` refresca al cambiar tab, `actorMap`
  procesa actorIds de gcal extendedProperties, `invalidateProfileCache` en
  SIGNED_OUT, `buildEventKey` estable entre piloto on/off, cierre de modal
  ante error.
- ✓ Bajos resueltos: search_path de `is_assistant_of`, modal nueva
  columna (reemplaza prompt nativo), debounce 200ms en buscador, búsqueda
  incluye observaciones de contactos, banner reconectar Google Calendar.
- ✓ Timezone: bug del +3hs (UTC vs ARG) corregido en `buildGoogleEventBody`,
  `handleMoveEvent`, `RegistrarGestion.confirmar`, `handleCreateTareaEnSlot`
  y `sincronizarSeguimiento` (todos los flujos que llamaban a `toISOString()`
  reemplazados por `dateToLocalIso`/`dateToGcalLocal`).
- ✓ DB: dropeada `calendar_sync_watches` (sin uso).

**Sesión 2026-05-15** (ver CHANGELOG.md):
- ✓ 5 críticos (escalada `assistant_of_id`, unlink gcal vía edge, useEffect
  guards, índices + FKs, admin-auth compartido en edge functions).
- ✓ Media de seguridad: `admin_full_access` sin DELETE.
- ✓ 4 bajas: constantes mágicas (`--app-max-w`), accesibilidad en modales
  (role/aria-modal/aria-labelledby), `loadState` con select explícito,
  `actorMap` lazy load.

**Backlog BAJA prioridad** (refactors sin cambio funcional, no urgentes):
- `App` component con ~1500 líneas: split candidato en custom hooks
  `useGcalSync`, `useAssistantContext`, `useAbordajeHandlers`. Abordar
  cuando al modificar `App` se sienta incómodo el tamaño.
- `UsuariosSection` ~385 líneas: split candidato en `UsuariosTable` +
  `NuevoUsuarioForm` + `UsuarioRow`. Idem.
- Labels en inputs de forms (40 inputs con `<label>Texto</label><input/>`
  adyacente; cambiar a label envolvente o agregar htmlFor+id).
- `MEGAADMIN_EMAIL` duplicado entre frontend (`index.html`) y edge function
  (`delete-user`). Mover a variable de entorno o tabla `app_settings`.
- `GCAL_TZ` hardcodeado a Buenos Aires (cuando IFS opere internacional,
  extraer a setting por user).
- `handleDeleteAgenda` para recurrentes: ofrecer "esta instancia" vs "toda
  la serie" (hoy borra toda la serie, avisa con modal pero no diferencia).
- Optional: habilitar Leaked Password Protection en Supabase Auth (1 click).

**No urgente / descartado**:
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
