# Planificador de Abordaje IFS — Estado actual

Estado vigente al 2026-08-31. Para la historia completa del proyecto y las
fases de migración ver `CHANGELOG.md`.

## Stack
- **Frontend**: single-file `index.html` con React 18 + Babel standalone.
  El `npm run build` precompila el JSX y sirve `public/index.html` sin Babel.
- **Libs vendorizadas (2026-08)**: React, ReactDOM, supabase-js, XLSX y jsPDF
  se sirven self-hosted desde `/vendor/` (archivos en `static/vendor/`, copiados
  a `public/vendor/` por el build), NO desde CDN. Elimina el riesgo de
  supply-chain y de caída de CDN. El build aborta si falta algún vendor.
- **Backend**: Supabase (Postgres + RLS + Edge Functions + Auth).
- **Calendar**: Google Calendar como fuente única para users que activan
  `gcal_enabled`. Domain-Wide Delegation para `@ifs-broker.com`, OAuth
  user-level para gmail externos.
- **Deploy**: Railway, auto-deploy en push a `main` del repo
  `nadirortizsarquis/abordaje-ifs`.
- **URL de producción**: https://abordaje.broker-ifs.com

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
- Compañía por tarea: click derecho en card del Kanban asigna aseguradora,
  logo en la esquina de la card. El LOGO se ve en mobile también; ASIGNAR la
  compañía es solo desktop (click derecho) por decisión — no se complica el
  mobile con eso (Nadir, ago 2026). No es un pendiente.
- Pestañas Lista/Tareas/Calendario sticky bajo el header al scrollear.
- Solapa "Archivo" en Lista: archivar prospects sin perder info.
- Admin: panel de pagos de mantenimiento mes × agente con export PDF;
  FAB "Abrir Claude Desktop" para mega-admin.
- Calendario con cache stale-while-revalidate (`_gcalViewCache`): al volver
  a la pestaña pinta al instante los eventos de la última visita y refresca
  Google en background.
- Relevamiento de necesidades ("8+1" estilo Life) por prospecto: botón en
  la ficha → modal casi pantalla completa con 8 bloques + nota libre,
  switch ARS/USD, autosave on-blur. Persiste en
  `abordaje_prospectos.relevamiento` (jsonb). Fuente: `8+1 y FF.pdf`
  (en la carpeta del proyecto, sin trackear). Botón "Descargar PDF" en el
  modal (`exportarRelevamientoPDF`) — **v1 funcional, Nadir quiere pulir
  el diseño del PDF más adelante** (pendiente declarado 2026-06-12).
- **Calendarios compartidos (2026-08-21).** Coordinación de reuniones entre
  asesores sin exponer datos. Opt-in por `profiles.compartir_calendario`
  (toggle propio en Ajustes → General; matriz admin owner→viewer en Ajustes →
  Compartidos). Solapa "Calendario compartido" (`CalendarioCompartidoView`):
  grilla con el formato del calendario normal, modo Ocupado (bloques anónimos
  por color, sin título) / Disponible (verde = todos libres). Eventos
  compartidos con invitaciones (viven en Abordaje, no tocan Google): crear
  desde la grilla o invitar desde los modales de agenda / cita de prospecto
  (solo tipo agendado) vía `MeetingInviteSection`. Identificador = contorno
  indigo. Aceptar/rechazar en el detalle; badge (N) en la solapa; al aceptar
  aparece en el calendario normal (render-only, sin duplicar el ocupado).
  Modal de tarea reestilado (más ancho + secciones tipo ficha de prospecto).
  - **"Mostrar mi agenda" (2026-08-31).** Check en el calendario compartido que
    superpone TUS propios eventos (con info, en gris) sobre la grilla de
    ocupados anónimos — solo en tu vista. Op `my_agenda` en `shared-calendar`.
- **Convertir prospecto en tarjeta (2026-08-31).** Botón en la ficha del
  prospecto que crea una tarjeta Kanban conservando el historial de abordaje
  (snapshot en la nota + link blando `abordaje_tareas.prospecto_ref_id`, que el
  sync NO toca — la tarjeta nunca se pisa). Migración `20260826120000`.
- **Calendario de pagos: pólizas inactivas (2026-08-31).** Las pólizas Lapsed /
  Cancelled / Rejected / etc. se muestran atenuadas y tachadas (`CALPAGO_LAPSED`,
  set `CALPAGO_INACTIVA_ESTADOS`) para distinguirlas de las vigentes.
- **Footer de punta a punta en mobile (2026-08-31).** La línea del footer rompe
  el padding lateral de `.main` en mobile para tocar los bordes del tablero.
- **Integración con el CRM de Bruno (2026-08, EN PRODUCCIÓN).** Botón "Convertir
  a cliente CRM" (`CrmVinculoLanzador`) en prospecto/tarea/agenda/cita: busca por
  DNI, vincula o crea el cliente, y vuelca la gestión a su bitácora. Typeahead
  "Cliente en el CRM" (`CrmClientePicker`) al crear. Ancla por `crm_client_id`
  (prospecto + a nivel ítem). Gating por asesor `advisors.crm_sync_enabled`
  (default OFF; admins por rol), enforced server-side en la edge function
  `crm-sync`. Detalle: `docs/INTEGRACION_CRM.md` · PM #819.

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
Código fuente versionado en `supabase/functions/` desde 2026-06-11
(idéntico al remoto). Modificar siempre el archivo local y deployar;
detalle en `supabase/README.md`.

| Función | Versión | Propósito |
|---|---|---|
| `gcal-events` | v14 | Calendar de Google (list/create/update/delete/listCalendars/unlink). Soporta DWD, OAuth user-level y modo asistente. |
| `gcal-events-admin` | v5 | Acceso admin al calendar de cualquier user (auth por service-role, sin JWT — `verify_jwt=false`, crítico, no tocar). `timingSafeEqualStr` para el shared-secret. Para MCP/Claude. |
| `gcal-oauth-init` | v4 | Inicia flujo OAuth para gmail externos. Firma state con HMAC. |
| `gcal-oauth-callback` | v4 | Recibe code de Google, guarda refresh_token, redirige a la app. |
| `create-user` | v12 | Alta de usuarios (admin). |
| `delete-user` | v10 | Baja de usuarios (megaadmin only). |
| `update-user-email` | v8 | Cambio de email (admin). Guard: solo el megaadmin puede cambiar el email de otro admin. |
| `update-user-password` | v10 | Cambio de password (admin). Guard: solo el megaadmin puede cambiar el password de otro admin. |
| `shared-calendar` | v4 | Calendario compartido. Ops `owners` / `busy` (ocupados anonimizados, sin título) / `meeting_people` (nombres de participantes, minimizado) / `my_agenda` (eventos propios para "Mostrar mi agenda"). Exige `compartir_calendario` ON. |
| `crm-sync` | v13 | Integración con el CRM de Bruno. Ops search/lookup/create/sync. `normDoc` + dedup (409 `duplicate_document`), link fail-closed, `verify_advisor`. Gating server-side por `advisors.crm_sync_enabled`. |

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
- **Hardening 2026-08** (migración `20260825120000`): `WITH CHECK` en las
  policies UPDATE que faltaban + trigger `meeting_invite_immutable` (un invitado
  solo puede tocar su propio `status`, no reasignarse el invite). Auditoría
  integral de 2026-08 (61 hallazgos en `docs/AUDITORIA_2026-08.json`): críticos y
  bordes resueltos y deployados; quedan diferidos por decisión #34 (CORS
  allowlist, no es vuln — el JWT mitiga) y #39 (paginación, mejora a futuro).

## Estructura de tablas (lado Abordaje)
- `profiles` — perfil de usuario
- `user_google_tokens` — refresh_token OAuth
- `abordaje_prospectos`
- `abordaje_prospecto_contactos` (historial de gestiones)
- `abordaje_tareas` + `abordaje_tareas_columnas` (`actor_id`/`updated_at`
  agregados 2026-05-21; `prospecto_ref_id` agregado 2026-08-26 — link blando de
  "convertir prospecto en tarjeta", `ON DELETE SET NULL`, el sync NO lo toca)
- `abordaje_agendados` (legacy, solo non-piloto)
- `abordaje_event_colors` (overrides visuales del calendar)
- `abordaje_calendar_shares` (matriz owner→viewer del calendario compartido)
  + `profiles.compartir_calendario` + RPC `set_compartir_calendario`
- `abordaje_calendar_meetings` + `abordaje_calendar_meeting_invites`
  (eventos compartidos + invitaciones; `source_ref` liga el meeting espejo al
  evento origen; helpers `can_see_meeting`/`is_meeting_creator`/`is_meeting_invitee`)
- ~~`calendar_sync_watches`~~ (dropeada 2026-05-21, era legacy del refactor
  viejo y no se usaba en ninguna parte)
- `abordaje_client_errors` (`20260831120000`) — error tracking en producción:
  cada error de runtime (ErrorBoundary, `window.error`, `unhandledrejection`) se
  registra vía `logClientError` (fire-and-forget, dedup + tope anti-flood).
  Columnas: user_id/email/app_version/source/message/stack/url/user_agent. RLS:
  INSERT abierto (anon+authenticated, el logging debe andar con sesión rota o en
  login), SELECT/DELETE solo admin. Se ven en Ajustes → solapa admin **Errores**
  (`ErroresSection`): tabla read-only con filtros usuario/versión/texto, chip de
  origen, stack expandible por fila y botón "Limpiar +30 días".

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
- ✓ **Refactor de `App` en custom hooks (#32) — HECHO (2026-08-31).** Se hizo en
  branch aparte (`refactor-32`, 11 pasos, cada uno con check+smoke+34 tests),
  se probó a mano en local (`localhost:3100`) y recién ahí se mergeó a
  producción. Extraídos a nivel módulo: `useSeguimientoEngine` (el motor de
  sync con `syncLocksRef`, `_runLockedProspecto`, `sincronizarSeguimiento`),
  `useContactoHandlers`, `useColumnas`, `useTareaBoardHandlers`, `useCalPagoUI`,
  más funciones puras testeables (`decidirSeguimiento`, `pickColumnaAbordar`,
  `buildObsTarea`, `appendBitacora`, `combinarFechaHora`, `deriveProximoContacto`,
  `extraerUltimaLineaBitacora`). `FilaProspecto` y `TareaCard` envueltos en
  `React.memo` con handlers estabilizados (`useCallback`). Cap de render de 500
  filas + "Mostrar más" en la lista de prospectos. `scripts/test.mjs` creció de
  9 a 34 tests de invariantes. Ya en producción, verificado en vivo.
  Anteriores (2026-06-16), también en producción: `useSettings` y
  `useNotificaciones`.
- `UsuariosSection` ~385 líneas: split candidato en `UsuariosTable` +
  `NuevoUsuarioForm` + `UsuarioRow`. Idem.
- Labels en inputs de forms (40 inputs con `<label>Texto</label><input/>`
  adyacente; cambiar a label envolvente o agregar htmlFor+id).
- `MEGAADMIN_EMAIL` duplicado entre frontend (`index.html`) y edge function
  (`delete-user`). Mover a variable de entorno o tabla `app_settings`.
- `GCAL_TZ` hardcodeado a Buenos Aires (cuando IFS opere internacional,
  extraer a setting por user).
- ✓ `handleDeleteAgenda` recurrentes: RESUELTO (2026-08-31). El modal ofrece
  "solo esta fecha" (borra el ID de la instancia → la edge cancela la ocurrencia)
  vs "toda la serie" (borra el `recurringEventId` maestro → DELETE completo).
  Client-only, sin tocar la edge (que ya cancelaba la instancia; el modal viejo
  avisaba mal que borraba toda la serie).
- Optional: habilitar Leaked Password Protection en Supabase Auth (1 click).

**No urgente / descartado**:
- Comentarios de autoría dentro de observaciones (texto plano → tabla de
  comentarios con autor/timestamp). Fase 3D conceptual.
- Managers/niveles jerárquicos. Descartado por riesgo de filtración RLS.

## Deploy y validación (desde 2026-06-11)
- **Build con precompilación** (`scripts/build.mjs`): `npm run build` extrae
  el bloque JSX de index.html, lo compila con @babel/standalone 7.29.7
  (presets react+env — la misma config que aplicaba el browser) y escribe
  `public/index.html` SIN Babel CDN. El index.html del repo sigue siendo
  single-file editable y funciona sin build (conserva su script de Babel);
  lo que se sirve es el artefacto precompilado. Para probar local:
  `npm run build && npm start` (rebuildear tras cada edición).
- **Libs self-hosted en `/vendor/`** (2026-08): React 18.3.1, ReactDOM,
  supabase-js, XLSX, jsPDF ya no vienen de CDN sino de `static/vendor/`. Ni un
  release nuevo ni una caída de CDN pueden romper producción. Para actualizar:
  reemplazar el archivo en `static/vendor/` y probar. Babel standalone solo se
  usa en el index.html editable (el artefacto servido ya viene precompilado).
- **`APP_VERSION`** (constante en index.html, visible en el footer del
  login). Bumpear en cada deploy — sirve para saber qué versión ve un user.
- **Cache**: `serve.json` manda `Cache-Control: no-cache` para index.html →
  el browser revalida en cada carga y los deploys impactan al instante.
- **Validación pre-deploy — `npm run verify`** (corre las tres):
  - `npm run check` — compila el JSX con el mismo Babel del browser; atrapa
    errores de sintaxis (pantalla blanca).
  - `npm run smoke` — monta la app real en jsdom + React; atrapa
    ReferenceErrors de runtime (hooks fuera de orden, `state` usado antes de
    declararse, etc.) que el check no ve.
  - `npm run test` — `scripts/test.mjs`, 44 tests de invariantes sobre las
    funciones puras (parseFechaLocal, deriveEstado con backtracking multinivel,
    normDoc, dedup, decidirSeguimiento con todos los tipos, appendBitacora,
    combinarFechaHora, etc.) — el núcleo de decisión del motor de sync.
  Hook local `.git/hooks/pre-push` corre `check && smoke && test` automático (el
  hook no se versiona: reinstalar con `printf '#!/bin/sh\nnpm run verify\n' >
  .git/hooks/pre-push && chmod +x .git/hooks/pre-push`).
- **Rollback si un push rompe producción**: `git revert HEAD && git push`
  (o en Railway: Deployments → redeploy del deploy anterior).
- **Límite de 1000 filas**: el helper `selectAllRows()` en index.html pagina
  todas las queries de listas — no volver a queries directas sin .range().

## Backups de la base de datos (desde 2026-06-11)
- **Contexto**: el proyecto Supabase está en plan **Free** (verificado
  2026-06-11) — Supabase NO hace backups propios. Este backup es la única
  copia de la data; no desactivarlo sin reemplazo.
- **Qué**: dump diario de Supabase (schemas `public`, `private`, `comisiones`,
  `patrimoniales`, `auth`, `supabase_migrations`) comprimido a
  `iCloud Drive → IFS/Backups Abordaje DB/ifs-db_YYYY-MM-DD.sql.gz`.
  Retención: 90 días. Log en `backup.log` de esa carpeta.
- **Cómo**: `scripts/backup-db.sh` (fuente en el repo; la copia que ejecuta
  launchd vive en `~/bin/abordaje-backup-db.sh` — si se edita la del repo,
  re-copiarla ahí). Programado con launchd
  (`~/Library/LaunchAgents/com.ifs.abordaje-db-backup.plist`), todos los
  días 10:00; si la Mac está dormida corre al despertar.
- **Credenciales**: password de la DB en el Keychain de macOS, item
  `"Abordaje DB Backup"` (account `abordaje`). `pg_dump` instalado vía
  `brew install libpq` (`/opt/homebrew/opt/libpq/bin/pg_dump`). Conexión por
  session pooler IPv4 (`aws-1-sa-east-1.pooler.supabase.com:5432`).
- **Nota TCC/macOS**: launchd solo tiene permiso sobre la carpeta iCloud para
  bash/cp/cat/rm (no gzip/find) — por eso el script trabaja en staging local
  y copia el .gz final con `cp`. No "simplificar" el script revirtiendo esto.
- **Restaurar**: `gunzip -c ifs-db_FECHA.sql.gz | psql "<DB_URL con password>"`
  contra un proyecto limpio (o pedirle a Claude que lo haga). Correr el backup
  a mano: `bash ~/bin/abordaje-backup-db.sh`.

## Cómo retomar en otra sesión
1. Leé este STATE.md primero.
2. Para detalle histórico de cada fase, `CHANGELOG.md`.
3. El index.html del frontend es la única fuente del cliente.
4. Las edge functions están versionadas en `supabase/functions/` (fuente);
   se deployan via MCP o `supabase functions deploy`. Nunca editar solo
   el remoto.
5. Migrations recientes en `supabase/migrations/`; el schema completo está
   en `supabase/schema_baseline.sql` (las migrations viejas viven solo en
   el remoto de Supabase).
