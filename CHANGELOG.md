# Changelog — Planificador de Abordaje IFS

> Para el estado actual del proyecto ver `STATE.md`. Este archivo guarda
> el historial de fases y refactors. Las secciones marcadas como
> "PENDIENTE" pueden haber sido completadas más abajo; el orden es
> cronológico.

---

# Refactor Google Calendar como fuente única — Estado al 2026-05-13

## Resumen
Migramos el calendar de Abordaje de modelo **híbrido** (réplica entre Supabase y Google) a modelo **fuente única en Google Calendar**. En modo piloto (`nortiz@ifs-broker.com`) el calendar lee/escribe directo en Google vía Domain-Wide Delegation. El resto de users sigue con calendar local hasta que migren a Workspace.

## Estado actual
- **NO** hay commit ni push pendiente — todo está en local en `index.html`.
- Edge function `gcal-events` v3 desplegada en Supabase (ACTIVE).
- Tablas obsoletas eliminadas. Columnas `google_event_id` agregadas a `abordaje_tareas` y `abordaje_prospecto_contactos`.
- Multi-calendar funciona: trae eventos de todos los calendars accesibles desde la cuenta laboral (incluyendo los compartidos como el personal de gmail).

## Setup Google Cloud (ya hecho)
- Proyecto GCP: `ifs-apps-496112` ("IFS Apps").
- Service Account: `abordaje-calendar-sync@ifs-apps-496112.iam.gserviceaccount.com`
  - Client ID (Unique ID): `100030772309160488896`
- Calendar API habilitada.
- Org policy `iam.disableServiceAccountKeyCreation` con override `enforce: false` para el proyecto (era bloqueante de keys).
- Rol `roles/orgpolicy.policyAdmin` asignado a `nortiz@ifs-broker.com` en la org.
- Key JSON local: `.gcp-sa-key.json` (gitignored).

## Setup Workspace Admin
- Domain-Wide Delegation autorizada: Client ID `100030772309160488896` con scope `https://www.googleapis.com/auth/calendar`.

## Setup Supabase
- Secret: `GOOGLE_SA_KEY` (contenido del JSON minificado).
- Edge function: `gcal-events` (única; reemplazó a `gcal-push` y `gcal-pull` que fueron eliminadas).

## Modelo de datos
Tablas eliminadas (deuda técnica del modelo híbrido viejo):
- `calendar_sync_events`
- `calendar_sync_tareas`
- `calendar_sync_pull_state`
- Columna `abordaje_agendados.sinc_google` eliminada.

Columnas agregadas:
- `abordaje_tareas.google_event_id text` — id del evento en Google asociado a la tarea (en piloto).
- `abordaje_prospecto_contactos.google_event_id text` — id del evento en Google para contactos tipo agendado (en piloto, futuro uso).

Tabla `abordaje_agendados`:
- Sigue existiendo para users non-piloto. En piloto, no se escribe ahí (los eventos viven solo en Google).
- Cuando todos migren a Workspace, eliminamos esta tabla.

## Edge function `gcal-events` v3
Single endpoint con ops: `list`, `create`, `update`, `delete`, `listCalendars` (debug).
- Solo opera para `nortiz@ifs-broker.com` (modo piloto). Otros users reciben `{ skip: 'user not in pilot' }`.
- `op=list` itera **todos los calendars accesibles** (sin filtrar `hidden`), trae eventos en paralelo, etiqueta cada uno con `_gcalId`, `_gcalSummary`, `_gcalColor`.
- `op=create/update/delete` operan en `primary` por default (param `calendarId` opcional).
- Usa `extendedProperties.private.abordaje_prospect_id` y `abordaje_tarea_id` para vincular eventos de Google con entidades de Abordaje.

**TODO pendiente para mañana**:
- ⚠️ La edge function tiene `console.log` temporales para diagnóstico. **Sacar** antes del commit final.
- Línea con `console.log("calendarList items:", ...)` y `console.log("cal ... → X eventos")`.

## Frontend
- Helper `gcalApi` (list/create/update/delete) en script global, antes de la app React.
- `isPilotUser(user)` flag.
- `buildGoogleEventBody({ startIso, summary, description, prospectId?, tareaId? })` constructor de body para eventos.
- `extractGcalEventsForCalendar(gcalEvents, prospectos)` mapea eventos de Google al formato interno del calendar UI.
- `colorCalendarEvento(e)` — para eventos externos (sin prospect/tarea id en extendedProps) usa el color del calendar de Google. Para eventos de Abordaje (prospect/tarea) mantiene paleta verde/violeta/etc.
- `CalendarioView` recibe `isPilot` y `gcalReloadKey`. Si piloto, hace fetch a `gcalApi.list` cuando cambia rango.
- Handlers (`handleSaveAgenda`, `handleUpdateAgenda`, `handleDeleteAgenda`, `handleCreateTareaEnSlot`, `handleUpdateTarea`, `handleDeleteTarea`, `sincronizarSeguimiento`) tienen branch `if (isPilot)` que va a Google; el else conserva el flujo viejo (DB local).
- `EditAgendaModal` acepta agenda con `{ googleEvent: ... }` (piloto) o `{ id, fecha, nota }` (non-piloto).
- `NuevaAgendaModal` con `submitting` guard para prevenir doble submit (causa de eventos duplicados).

## Bugs resueltos durante el refactor
1. Eventos duplicados al crear "Nueva agenda" — era doble submit por Enter+click. Resuelto con `submitting` flag.
2. No se veían calendars compartidos (gmail personal) — Google los marcaba `hidden=true` en `calendarList` cuando estaban "desmarcados" en sidebar. Resuelto removiendo filtro y agregando `showHidden=true` en query.

## Cómo retomar mañana
1. Testing en local con cuenta `nortiz@ifs-broker.com`:
   - Crear "Nueva agenda" → aparece en Google y en Abordaje, sin duplicarse.
   - Crear "Nueva tarea" desde calendar → aparece en ambos lados.
   - Editar/borrar desde Abordaje → se refleja en Google.
   - Borrar desde Google → al refrescar Abordaje desaparece (porque calendar lee directo).
   - Verificar que los eventos del calendar personal aparezcan en colores propios.
   - Probar el flujo de prospect → "Registrar gestión: Agendado" → ¿el evento aparece en Google con `abordaje_prospect_id`?
2. **Sacar console.logs** de `gcal-events` antes del commit final.
3. Commit + push (mensaje sugerido: "Refactor: Google Calendar como fuente única para users piloto").
4. Pensar la migración del resto de agentes:
   - 3 agentes con mails fuera de gmail → necesitan migrar a Workspace o pedirles login Google con scope Calendar.
   - Idea pendiente: cuando user no-piloto clickee la tab Calendario, mostrarle "Necesitás iniciar sesión con Google para usar el calendar — ¿vincular ahora?".

## Archivos clave
- `index.html` (modificado, sin commit).
- `.gcp-sa-key.json` (gitignored).
- `.gitignore` (modificado, agrega la key).
- Esta nota: `NOTAS-GCAL-REFACTOR.md`.

---

# Fase 1 (DONE — testing) — Toggle opt-in en Ajustes para Workspace

Implementado el 2026-05-13 (commit `7de5227`). Status: en producción, testing.

## Qué cambió
- Columna `profiles.gcal_enabled` (boolean, default false). El agente decide si vincular.
- Nueva sección "Google Calendar" en SettingsModal con explicación + toggle.
- `isPilotUser(user)` → reemplazado por `isGoogleCalendarUser(profile)`: valida `gcal_enabled=true` AND dominio Workspace `@ifs-broker.com`. `canEnableGoogleCalendar(profile)` decide si mostrar el toggle.
- Edge function `gcal-events` v5: acepta cualquier user del dominio Workspace (no email hardcodeado) y valida `gcal_enabled=true`.
- `nortiz@ifs-broker.com` arrancó con `gcal_enabled=true` para no perder el calendar al deployar.

## Casos por tipo de cuenta (Fase 1)
- **`@ifs-broker.com`** (Workspace) → ve toggle en Ajustes. Click → vinculación automática vía DWD (cero clicks extra).
- **Cualquier otro email** → ve mensaje informativo "Por ahora solo cuentas del dominio…" sin toggle.

## Pending para Fase 1
- Testing con varios agentes del dominio (Nadir va a probar mañana o cuando pueda).
- Decidir si los agentes que entren por primera vez tienen el toggle off por default y se les avisa, o si conviene un onboarding automático.

---

# Fase 2 (PENDIENTE) — OAuth user-level para gmail personales

Objetivo: que los agentes con gmail personal (`@gmail.com`, no del dominio Workspace) puedan también vincular su Google Calendar a Abordaje sin que DWD aplique.

## Cómo funcionaría desde el lado del agente
1. Logueado con su gmail, entra a Ajustes → Google Calendar.
2. Ve mensaje específico: *"Tu cuenta es gmail.com. Click en Vincular. Google te va a pedir permiso una vez."*
3. Click → pantalla de Google: *"Abordaje quiere ver y editar tu calendar. ¿Permitir?"*.
4. Click Permitir → vuelve a Abordaje con `gcal_enabled=true` automáticamente. Listo.

Solo agrega 1 pantalla extra la primera vez, comparado con dominio Workspace.

## Lo que falta implementar
1. **Google Cloud Console** (manual, Nadir):
   - Agregar scope `https://www.googleapis.com/auth/calendar` a las credenciales OAuth Web Application existentes (las del "Continuar con Google" del login).
   - **OAuth Consent Screen** en modo Testing (alcanza para pocos users): agregar cada gmail del agente como **Test User** en Google Cloud Console. **Pega importante**: los test users van a ver una pantalla *"App no verificada"* con botón "Continuar (no seguro)" — feo pero funcional para piloto.
   - Cuando crezca, pasar a modo Production (requiere Google Verification, 4-6 semanas).

2. **Supabase** (yo):
   - Nueva tabla:
     ```sql
     create table public.user_google_tokens (
       user_id      uuid primary key references auth.users(id) on delete cascade,
       refresh_token text not null,
       granted_at   timestamptz not null default now()
     );
     alter table public.user_google_tokens enable row level security;
     revoke all on public.user_google_tokens from anon, authenticated;
     ```
   - Considerar encriptar `refresh_token` con pgcrypto o usar Supabase Vault.

3. **Frontend** (yo):
   - En `GoogleCalendarSection`, branch para gmail externo: botón "Vincular con Google" en lugar de toggle. Dispara `supabase.auth.signInWithOAuth({ provider: 'google', options: { scopes: 'https://www.googleapis.com/auth/calendar', queryParams: { access_type: 'offline', prompt: 'consent' } } })`.
   - Callback: cuando vuelve con código, una edge function nueva `gcal-oauth-link` intercambia código por refresh_token, lo guarda en `user_google_tokens`, setea `gcal_enabled=true`.
   - Para desactivar: borrar la fila de `user_google_tokens` + `gcal_enabled=false`.

4. **Edge function `gcal-events` v6** (yo):
   - Detecta el tipo de user:
     - Si email es del dominio Workspace → usar DWD (flujo actual).
     - Si NO es del dominio → buscar `user_google_tokens.refresh_token`, intercambiarlo por access_token, usar ese.
   - Manejo de refresh transparente (Google da access_tokens de 1 hora; el refresh_token se usa internamente cada vez).

5. **`isGoogleCalendarUser`** (yo) — actualizar para que devuelva true si:
   - `gcal_enabled=true` AND (es del dominio Workspace OR tiene refresh_token en `user_google_tokens`).

## Trade-offs / consideraciones
- **Pantalla "App no verificada"**: en modo Testing, Google muestra warning a los users. Para que desaparezca hay que hacer Google Verification (proceso largo y formal).
- **Privacidad y consentimiento**: a diferencia de DWD donde el admin del dominio autoriza, acá cada user da consentimiento individual. Más alineado con buenas prácticas.
- **Revocación**: el user puede revocar el acceso desde Google Account Settings → eventos van a fallar hasta que reactive. Hay que manejar el error 401/403 en la edge function.
- **Tokens encriptados**: para producción, mejor encriptar el refresh_token con pgcrypto (key en secret de Supabase) en vez de plaintext.

## Cómo retomar Fase 2
1. Confirmar con Nadir cuántos agentes tienen gmail personal (cantidad aproximada para decidir si Testing alcanza).
2. Nadir hace los pasos manuales en Google Cloud Console (agregar scope + test users).
3. Aplicar migration de `user_google_tokens`.
4. Implementar edge function `gcal-oauth-link` para el callback.
5. Actualizar `gcal-events` para detectar tipo de user y usar el flujo correspondiente.
6. Actualizar `GoogleCalendarSection` UI con branch para gmail externo.
7. Testing con 1 agente externo.
8. Roll-out al resto.

Estimado: 3-4 horas de implementación + 30 min de setup manual + testing.

---

# UX y features adicionales (DONE) — 2026-05-14

Después del refactor base, se sumaron mejoras de UX al calendar y a la
plataforma en general. Todo en producción.

## Calendar — UX visual
- **Eventos solapados estilo Google** (`commit 6ae32e2`): algoritmo greedy de
  columnas (`layoutEventsInDay`) divide el ancho horizontal según la cantidad
  de overlaps. Modifier `.crowded` reduce padding y font-size cuando hay 2+
  eventos en el mismo horario. Cada uno se posiciona con `left%`/`width%`
  inline computado.
- **Tooltip al hover**: cada evento tiene `<div class="cal-event-tooltip">`
  hijo que aparece a la derecha. Muestra hora, título, observación y nombre
  del calendar de origen. Flip automático a la izquierda en los últimos 2
  días para no salirse del viewport. Oculto en mobile (touch no tiene hover
  real).
- **Drag & drop**: pointer events con threshold 5px (mouse) para distinguir
  click de drag. Snap a 15 min al soltar. Preview visual del slot destino
  (rectángulo punteado azul con la hora exacta).
- **Long-press en mobile**: 400ms con dedo quieto antes de activar drag, así
  el scroll touch no se confunde con drag accidental. Feedback visual:
  evento se "levanta" (scale 1.02 + shadow). `body.cal-dragging` bloquea
  `touch-action` mientras está activo.
- **Citas de prospect no-arrastrables**: cursor `not-allowed` + tooltip
  *"Cita agendada desde prospect — editala desde su ficha"*. El click sigue
  abriendo el modal del prospect.

## Handler de move
`handleMoveEvent(e, newStartIso)` en App decide qué entidad actualizar:
- `kind === 'prospecto'` → toast informativo, no se mueve (hay que editar el
  contacto del prospect).
- En piloto + `googleEvent` → `gcalApi.update` directo a Google.
- En piloto + `kind === 'tarea'` → además actualiza `abordaje_tareas` para
  que el card del kanban refleje la nueva fecha.
- En non-piloto: `handleUpdateAgenda` / `handleUpdateTarea` según corresponda.

## Multi-calendar
`gcal-events` v3+ lista todos los calendars accesibles desde la cuenta
Workspace (primary + compartidos + suscriptos). Cada evento trae `_gcalId`,
`_gcalSummary`, `_gcalColor`. Eventos sin `abordaje_*_id` en
extendedProperties (los "externos") se pintan con el color del calendar de
origen via `deriveColorsFromGcalHex`.

## Eventos recurrentes (fix)
`gcal-events` v6: cuando se borra un evento, hace GET previo y si tiene
`recurringEventId` (es instancia de un recurrente), usa
**PATCH `status: 'cancelled'`** en vez de DELETE. Sin esto las instancias
"virtuales" se regeneraban después del refresh.

## Persistencia de vista
La tab activa (`'lista' | 'tareas' | 'calendario'`) se guarda en
`localStorage.abordaje_view`. Al refresh se mantiene en lugar de volver a
"lista".

## Mobile responsive (commit `cbccd38`)
- **Header**: 2 filas en mobile (logo + título + iconos arriba, buscador
  full-width abajo). `--header-h` pasa de 78px a 130px.
- **Calendar semana**: scroll horizontal con `min-width: 95px` por día.
  Columna de horas pasa de 60px a 44px. Tooltip al hover oculto en touch.
  Sincronización del scroll horizontal header ↔ body via JS ref + `onScroll`.
- **Tabla de prospectos**: `overflow-x: auto` con `min-width: 720px` en la
  tabla → scroll horizontal preserva todas las columnas. (Si querés vista
  card vertical en mobile, dejarlo para otro round.)

## Edición de email del agente
Edge function `update-user-email` actualiza `auth.users.email` Y
`profiles.email` en una sola operación (`auth.admin.updateUserById` con
`email_confirm: true` para saltar verificación del agente). El `user_id`
queda intacto → no hay filas viejas.

## Toggle Calendar con `gcal_enabled`
`profiles.gcal_enabled` (boolean, default false). Sección "Google Calendar"
en SettingsModal con explicación + toggle. El frontend usa
`isGoogleCalendarUser(profile)` que valida flag + dominio. Cuando se activa,
el calendar pasa a Google; cuando se desactiva, vuelve al modelo local.

## API gcalApi — propaga calendarId
`gcalApi.update(eventId, event, calendarId)` y `gcalApi.delete(eventId,
calendarId)` ahora reciben el `calendarId` del evento (no siempre 'primary').
Necesario para operar sobre eventos compartidos del calendar personal.
`handleMoveEvent`, `handleUpdateAgenda`, `handleDeleteAgenda` pasan
`e.googleEvent._gcalId`.

## Commits relevantes
- `7de5227` Calendar Google: toggle opt-in en Ajustes para users del dominio
  Workspace
- `eff7c7c` admin: edición de email del agente desde la fila de usuarios
- `6ae32e2` Calendar: overlap + tooltip + drag&drop + responsive mobile + fixes
- `cbccd38` Mobile responsive: header 2-filas + tabla scroll horizontal
- `30a3f01` Calendar mobile: long-press para activar drag en touch

## Estado al cierre del día (2026-05-14)
- Producción funcionando para `nortiz@ifs-broker.com` con todas las features.
- Pendiente testing por otros agentes Workspace.
- Pendiente Fase 2 (OAuth user-level) para gmail personales — ver sección
  arriba.

---

# Fase 2 (DONE) — OAuth user-level para gmail externos

Implementada el 2026-05-14 (commit `4b2f172`). Status: en producción.

## Qué cambió
- Tabla `user_google_tokens(user_id PK, refresh_token, scope, granted_at,
  last_used_at)` con RLS deny-all (solo edge functions via service_role).
- Edge function `gcal-oauth-init`: el frontend la llama para iniciar. Genera
  URL de OAuth de Google con `state` HMAC-firmado (incluye user_id + returnTo
  + timestamp).
- Edge function `gcal-oauth-callback` (verify_jwt: false): Google la llama
  con `code+state`. Valida state, intercambia code por tokens, guarda
  refresh_token, activa `profiles.gcal_enabled`, redirige al user.
- Edge function `gcal-events` v9: detecta tipo de user por dominio:
  - Workspace → DWD (impersonate via service account).
  - Externo → busca refresh_token, lo intercambia por access_token cada call.
    Si `invalid_grant` (token revocado por el user), limpia el row y desactiva
    `gcal_enabled` para forzar re-link.
- Frontend `GoogleCalendarSection`: 3 branches según tipo de cuenta.
  - Workspace: toggle simple (DWD automático).
  - Gmail externo: botón "Vincular con Google Calendar" + "Desvincular".
  - Cuenta no-Google: mensaje informativo, sin acciones.
- App: handlers `handleLinkOAuth` y `handleUnlinkOAuth`. useEffect que
  detecta `?gcal_linked=1` / `?gcal_error=...` en el querystring al volver
  del callback y refresca el agente con un toast.

## Setup manual (ya hecho)
- Google Cloud Console:
  - Authorized redirect URI agregada:
    `https://hxjpnekzncqepbhpdkfv.supabase.co/functions/v1/gcal-oauth-callback`
  - Client Secret nuevo creado y guardado en Supabase como
    `GOOGLE_OAUTH_CLIENT_SECRET`. El secret viejo sigue vivo (lo usa Supabase
    para login con Google).
  - OAuth Consent Screen: scope `https://www.googleapis.com/auth/calendar`
    agregado.
  - App pasada de "En producción" a "Modo de prueba". Test users:
    `maidanavictoria5@gmail.com`, `di.creativo12@gmail.com`. Cada nuevo
    agente gmail externo debe agregarse acá manualmente.
- Supabase secrets:
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_STATE_SECRET` (random 32 bytes hex, generado al deploy)

## Pega de UX: pantalla "App no verificada"
Como la app está en modo Testing, Google muestra a los test users una
advertencia *"Esta app no fue verificada por Google"*. Para pasarla:
1. Click "Avanzado" (abajo a la izquierda).
2. Click "Ir a IFS Supabase (no seguro)".

Cuando crezca, pasar a modo Production con Google Verification (proceso de
4-6 semanas, requiere documentación + video demo). Por ahora alcanza con
Testing.

---

# Fase 3 (PENDIENTE / en plan) — Modelo de Asistentes

Permitir que un user "asistente" trabaje en nombre de un agente principal:
ve los mismos prospects/tareas/calendar, puede crear/editar/eliminar como si
fuera el agente, pero cada acción queda marcada con su `actor_id` para
trazabilidad.

## Modelo de datos propuesto
- `profiles.assistant_of_id uuid` (FK a profiles): si está set, este user es
  asistente del agente referenciado.
- `profiles.shares_calendar_with_assistant boolean default false`:
  consentimiento del agente para que su asistente vea su Google Calendar.
- Por cada tabla operable agregar `actor_id uuid` (`abordaje_prospectos`,
  `abordaje_prospecto_contactos`, `abordaje_tareas`, `abordaje_agendados`).
  - `agente_id` = a quién pertenece el registro (sigue como hoy).
  - `actor_id` = quién hizo la acción (asistente o agente).

## RLS
Extender las policies de las tablas operables de:
`agente_id = auth.uid()`
A:
`agente_id = auth.uid() OR agente_id = (select assistant_of_id from profiles where id = auth.uid())`

## Frontend
- Detectar si el user tiene `assistant_of_id` → modo asistente activado.
- Cargar datos del agente principal (no del asistente). Banner sutil arriba:
  *"Trabajando como asistente de Federico"*.
- Toda acción registra `actor_id = auth.uid()`.
- Marca visual (estrella o similar) en cards/listas donde `actor_id != agente_id`.
- Bitácora con prefijo *"· asistente"* en entradas creadas por asistente.

## Google Calendar para asistentes
- **Agente principal — en Ajustes**: nuevo checkbox bajo Google Calendar:
  *"Permitir que mi asistente vea y edite mi Google Calendar"*. Con texto
  explicativo de qué implica (lectura + escritura bidireccional).
- **Asistente — en Ajustes**: branch propio en `GoogleCalendarSection`:
  - Botón "Vincular **mi** Google Calendar" (su propio calendar personal).
  - Si el agente principal activó `shares_calendar_with_assistant=true`,
    aparece info: *"También podés ver el calendar de Federico (autorizado
    por él)"*.
  - El asistente puede tener AMBOS calendarios visibles a la vez (el suyo
    + el del agente). La edge function `gcal-events` itera los calendars
    accesibles para el caller y los combina.

## Implementación al lado server
- `gcal-events` actualizado para que cuando el caller es asistente con
  shares_calendar_with_assistant del principal=true, además de su propio
  flujo (DWD o refresh_token), agregue los eventos del agente principal
  (DWD si principal es Workspace, refresh_token si externo). Los eventos
  del principal vienen marcados con `_isPrincipal: true` para que el
  frontend pueda colorearlos distinto si quiere.

## Cosas a tener cuidado
- **RLS son la línea de defensa de la DB**. Probar con casos puntuales antes
  de pushear: asistente solo ve los del principal, no de otros; principal
  sigue sin ver nada del asistente.
- **El consentimiento del agente para compartir calendar es revocable** en
  cualquier momento. Cuando se desactiva, el asistente deja de ver el
  calendar del principal en la siguiente refresh.

## Estimación
- Migration + RLS: 1h.
- Frontend (modo asistente + marca visual + banner): 2h.
- Calendar compartido (checkbox + edge function): 1.5h.
- Testing con cuenta real: 1h.

Total: ~5h.

## Decisión sobre managers / niveles jerárquicos
Se descartó implementar relaciones de manager (Molina ve a Tarquini/Alonso)
por ahora, para evitar el riesgo de filtraciones inadvertidas vía RLS mal
configuradas. Cuando la estructura organizacional crezca y haga sentido,
se retoma con testing dedicado.

---

# Fase 3 (DONE) — Asistentes + extras de UX (2026-05-14)

Implementación completa de Fase 3, testeada en local con Nadir (principal) y
Carolina (asistente). En producción tras este commit.

## Modelo de datos aplicado
- `profiles.assistant_of_id uuid` y `profiles.shares_calendar_with_assistant boolean`.
- `actor_id uuid` agregado a `abordaje_prospectos`, `abordaje_prospecto_contactos`,
  `abordaje_tareas`, `abordaje_agendados`.
- Helper RLS `private.is_assistant_of(target_id uuid) returns boolean`.
- Policy `profiles_select` actualizada:
  `auth.uid() = id OR private.is_admin() OR private.is_assistant_of(id)`.

## Backend
- `gcal-events` v10: si el caller tiene `assistant_of_id`, resuelve el
  principal y opera sobre su calendar **solo si**
  `shares_calendar_with_assistant=true` y `gcal_enabled=true`. Si no,
  devuelve `{skip}` (calendar vacío para el asistente, sin error).
- `gcalApi.create/update` decoran `extendedProperties.private` con
  `abordaje_actor_id` y `abordaje_agente_id` para preservar autoría en eventos
  externos a Abordaje.

## Frontend (modo asistente)
- `auth.getEffectiveAgenteId()`: si el user es asistente devuelve el id del
  principal. Cache local.
- Banner sutil arriba: *"★ Estás trabajando como asistente de NOMBRE · todo
  lo que hagas queda registrado con tu nombre"*.
- `isPilot` para asistentes mira `principalProfile.gcal_enabled` y
  `shares_calendar_with_assistant`, no su propio `gcal_enabled`.
- `loadAllProfiles` trae `assistant_of_id` y `shares_calendar_with_assistant`.
- Admin Panel: dropdown "Es asistente de (opcional)" en el form de alta y en
  el inline edit. Filtro: un asistente no puede serlo de otro asistente.
- Display "★ asist. de X" en cada fila de profile.
- Ajustes → Google Calendar: nuevo bloque visible solo si el agente tiene
  asistente(s) asignado(s), con toggle *"Compartir mi Google Calendar con mi
  asistente"* + confirmación al activar.

## Marca visual de autor (ActorStar)
- Cada CREATE y UPDATE de las entidades operables setea
  `actor_id = user.id` (modelo "último que tocó"; cuando el principal edita,
  la estrella desaparece automáticamente).
- `updateTarea` con patch solo de `googleEventId` NO pisa actor (sync interno
  post-create).
- Componente `<ActorStar item>` muestra ★ amarillo si `actorId != agenteId`.
- Context `ActorContext` provee mapa `actor_id → { display_name, email }`
  cargado una vez en App.
- Tooltip al hover: *"Modificado por NOMBRE · DD/MM HH:MM"* (usa
  `updatedAt || createdAt`).
- Aplicado en: cards de prospects, cards de tareas, filas de timeline,
  filas de historial (panel lateral), eventos de calendar (mes/semana/día).

## Colores custom de eventos del calendar
- Tabla `abordaje_event_colors` con `agente_id`, `event_key`, `color`,
  `actor_id`, `created_at`, `updated_at`, unique `(agente_id, event_key)`.
- RLS coherente con asistentes/admin.
- `event_key` formato: `prospecto:UUID`, `tarea:UUID`, `agenda:UUID`,
  `gcal:GOOGLE_EVENT_ID`.
- Paleta `EVENT_COLOR_PALETTE` de 8 colores: rojo, naranja, amarillo, verde,
  turquesa, azul, rosa, gris.
- `EventColorContext` provee `{colors, setColor}` al árbol.
- Click derecho sobre cualquier tarjeta del calendar abre popover con los 8
  swatches + botón "Quitar color".
- Override es **local** (en nuestra BD), no toca Google. Funciona para
  eventos nativos y eventos externos de Google Calendar.
- `colorCalendarEvento(e, colorsMap)` mira override antes de aplicar reglas
  automáticas. Cuando no hay override, vuelve al color por tipo de gestión.

## Otras mejoras de UX (mismo día)
- **Modal de Instrucciones**: botón "Instrucciones" a la izquierda del
  buscador en el header, abre modal con 9 secciones colapsables (Primer
  arranque, Prospectos, Etiquetas, Tareas, Calendario, Notificaciones,
  Asistente, Ajustes, Atajos).
- **Refresh al cambiar de tab**: alternar entre Lista / Tareas / Calendario
  dispara `loadState` silencioso (sin spinner) + `bumpGcal` si está en
  modo piloto. Útil cuando asistente y principal trabajan en paralelo.
- **Alineación del header en monitores grandes**: padding lateral del header
  matchea el `max-width: 1520` del `.main`, así "Salir" no se desborda más
  allá del botón "+ Nuevo prospect".
- **Breakpoint intermedio (721-1280px)**: aprieta header (padding 14, gap
  10), reduce input del buscador a 180px y compacta el botón Instrucciones.

## Bugs corregidos en esta sesión
- Constraint `abordaje_prospectos_estado_check` no aceptaba estado
  `programado` (lo usaban las etiquetas "Llamar semana próx", "Fecha exacta",
  "Llamar dentro de…"). Migration agregó `programado` al check.
- Carolina (asistente) no podía leer el `display_name` del principal por RLS.
  Fix: policy `profiles_select` extendida con `private.is_assistant_of`.
- Header colors de columnas `col-detalle / col-referente / col-pref` se
  veían oscuras en mobile (se mezclaba estilo de `td` con el de `th`). Fix:
  separar selectores en CSS.

## Cierre del proyecto
Push final a Railway tras este commit. El piloto deja de ser exclusivo de
`nortiz@ifs-broker.com`: cualquier user del dominio Workspace que active
el toggle en Ajustes empieza a usar Google Calendar como fuente. Gmail
externos activan vía OAuth user-level (Fase 2). Asistentes ya pueden
operar dentro del workspace de su principal con trazabilidad por estrella.

---

# Auditoría — Críticos resueltos (2026-05-15)

Auditoría profunda del codebase identificó 25 hallazgos. Resueltos los 5
críticos + el de seguridad MEDIA. Resto en backlog (ver `STATE.md`).

## Seguridad
- **Cierre de escalada de privilegios via `assistant_of_id`**: la policy
  `update_own_metadata` solo bloqueaba cambios al `role`. Cualquier user
  podía auto-asignarse `assistant_of_id` y ganar acceso al workspace
  ajeno. Nueva WITH CHECK declara `role`, `assistant_of_id` y `email`
  inmutables desde update propio. Admins siguen pudiendo cambiarlos via
  policies `admin_*`. Testeado: Victoria intentando setear
  `assistant_of_id=Gaston` → `42501: violates RLS policy`.
- **`admin_full_access` sin DELETE**: la policy original era `cmd=ALL`,
  permitiendo a cualquier admin hacer DELETE directo de profiles desde
  el cliente, saltando la edge function `delete-user` (que restringe a
  megaadmin). Reemplazada por `admin_select_all` + `admin_insert` +
  `admin_update`. DELETE solo via edge function con service_role.
- **`user_google_tokens` delete vía edge function**: el frontend hacía
  `sb.from('user_google_tokens').delete()` desde el cliente, pero la
  tabla tiene RLS sin policies (intencionalmente — secrets solo
  service_role), por lo que fallaba silencioso y dejaba refresh_tokens
  zombi. Migrado a `gcal-events` v11 con nuevo `op="unlink"`.

## DB
- Índice `profiles(assistant_of_id) WHERE NOT NULL` para acelerar
  `private.is_assistant_of()`.
- Índice `abordaje_prospecto_contactos(agente_id)` que faltaba pese a
  que `loadState` filtra por esa columna.
- 4 FKs en `actor_id` de las tablas operables con `ON DELETE SET NULL`,
  validadas (sin huérfanos preexistentes).
- Constraint `abordaje_prospectos.estado_check` consolidado con
  `'programado'` como migration nombrada (era un hotfix suelto).
- Migrations de esta sesión bajadas a `supabase/migrations/` local.

## Frontend
- 4 useEffects con `setState` async ahora tienen guard
  `cancelled` para evitar warnings de "setState on unmounted component"
  cuando se navega rápido entre tabs (el refresh-on-tab-switch agregó
  presión sobre este patrón).
- `mapContactoFromDB` ahora retorna también `prospectoId`. Era un
  campo faltante; nadie lo usaba todavía pero ya estaba listo el bug.
- Buscador global extendido: ahora también busca en eventos de Google
  Calendar (summary + description). Carga lazy con cache 5 min, rango
  -3m / +12m. Resultados con `googleEvent` abren directamente el modal
  de edición.
- Comentarios de `isPilot` actualizados: ya no es flag exclusivo de
  Nadir, es "user con gcal_enabled=true". El nombre de variable quedó
  por compatibilidad con call sites.

## Edge functions
- Las 4 funciones de gestión de usuarios (`create-user`, `delete-user`,
  `update-user-password`, `update-user-email`) ahora usan
  `_shared/admin-auth.ts` con helper `requireAdmin(req)`. Eliminadas
  ~100 líneas de boilerplate duplicado.
- `gcal-events` v11 agregó `op="unlink"` (descrito arriba).

## Docs
- Doc dividido: `STATE.md` (estado actual) + `CHANGELOG.md`
  (esta historia). Antes era un solo archivo
  `NOTAS-GCAL-REFACTOR.md` que mezclaba historia y estado, lo que
  dificultaba leer "qué está vigente" para alguien nuevo.
- `supabase/README.md` con overview del schema, edge functions y
  policies clave.

---

# Auditoría — Bajas resueltas (2026-05-15, misma sesión)

Continuación de la auditoría con los pendientes de BAJA prioridad que
agregaban deuda menor pero acumulable. Se resolvieron 4 de 6; las 2
restantes (splits de `App` y `UsuariosSection`) se dejan en backlog
como refactors sin cambio funcional.

## Frontend
- **Constantes mágicas**: `max-width: 1520px` se repetía en 3 lugares
  del CSS (`.main` y los dos paddings dinámicos del `.header`). Extraído
  a la variable CSS `--app-max-w` en `:root`.
- **Accesibilidad de modales**: agregados `role="dialog"` +
  `aria-modal="true"` + `aria-labelledby` apuntando al título a los 9
  modales del proyecto: `InstruccionesModal`, `SettingsModal`,
  `TareaModal`, `NuevoProspectoModal`, `ConvertirTareaModal`,
  `ChangePasswordModal`, `SlotChooserModal`, `EditAgendaModal`,
  `NuevaAgendaModal`. El input del buscador también recibió `aria-label`.
- **`loadState` con select explícito**: reemplazado `select('*')` en las
  5 tablas (`abordaje_prospectos`, `_prospecto_contactos`,
  `_tareas_columnas`, `_tareas`, `_agendados`) por listas explícitas de
  columnas declaradas en constantes locales (`PROSPECTO_COLS`,
  `CONTACTO_COLS`, etc.). Ahorra ancho de banda y documenta qué consume
  cada mapper.
- **`actorMap` lazy**: antes traía todos los profiles visibles via RLS
  en cada login. Ahora trae solo los profiles cuyo id aparece como
  `actor_id` en alguna entidad del state cargado y no está todavía en
  el cache. Refetch incremental cuando aparece un actor nuevo (ej. la
  asistente carga algo mientras vos navegás).

## Backlog explícito (no abordado)
- Split del `App` component (1197 líneas) en custom hooks
  `useGcalSync`, `useAssistantContext`, `useAbordajeHandlers`.
  Refactor sin cambio funcional, riesgo de romper cosas sutiles
  (closures, deps de useEffect). Mejor abordar en sesión dedicada
  cuando al modificar `App` se sienta incómodo el tamaño.
- Split de `UsuariosSection` (385 líneas) en `UsuariosTable` +
  `NuevoUsuarioForm` + `UsuarioRow`. Idem.

## Cierre de auditoría
Resueltos los 5 críticos + 1 media de seguridad + 4 bajas. Quedan 2 bajas
estructurales en backlog (splits sin cambio funcional) y 2 pendientes
históricos sin urgencia (comentarios de autoría dentro de observaciones,
managers/jerarquías). El proyecto está estable, seguro y documentado.

---

# Sesión 2026-05-21 — UX mobile + auditorías + timezone

Sesión larga con varios bloques:

## Bloque 1 — Kanban mobile

- **Long-press 400 ms** en `TareaCard` para activar drag en touch. Antes el
  drag arrancaba con cualquier movimiento >6px → scrollear con dedo sobre
  una card movía la card sin querer. Patrón idéntico al que usa el calendar.
  Feedback visual: `.long-press-armed` (scale 1.02 + shadow).
- **Columnas Kanban sin tope vertical en mobile** (`@media max-width: 720px`).
  Cada columna toma su altura natural con todas las cards visibles (sin
  scroll interno). Se mantiene el scroll horizontal entre columnas.
- **Reorden de columnas con confirmación**: drop abre `ConfirmColMoveModal`
  ("¿Mover columna X antes/después de Y?") antes de persistir.
  Long-press 400 ms también en el header de columna para mobile.

## Bloque 2 — Auditoría 1: críticos de calendar/tareas

- **Color de tareas en calendar siempre lila** (`colorCalendarEvento` con
  branch `kind === 'tarea' → CAL_COLOR_VIOLETA`). Antes heredaban tipo del
  último contacto del prospect, lo que las pintaba verde si el prospect
  pasaba a estado 'agendado'.
- **`handleUpdateTarea` sincroniza state local con `googleEventId`**. Antes,
  al crear evento Google, solo guardaba en DB y dejaba state stale → la
  siguiente edición creaba evento duplicado en lugar de actualizar el
  existente. Resolvió un caso real (evento del 25 huérfano + evento del 26
  activo, ambos apuntando a la misma tarea).
- **`handleArchiveTarea`**: archivar muta `tarea.googleEventId = null`,
  desarchivar limpia stale + sincroniza state con el evento nuevo.
- **`handleMoveEvent` usa `storage.updateTarea`** (no `sb.from` directo)
  para preservar `actor_id` cuando un asistente mueve tarea via drag.
- **Modal de confirmación al eliminar tarea**: ofrece "Solo sacar del
  calendar" vs "Borrar tarea completa". Quita el `confirm()` nativo.

## Bloque 3 — Auditoría 2: 3 agentes en paralelo

Lanzados 3 subagentes para auditar: modelo de asistentes, calendar/gcal
sync, y CRUD de tareas/prospects/`sincronizarSeguimiento`.

**Críticos resueltos** (4):
1. **Race condition en `sincronizarSeguimiento`**: lock por `prospectoId`
   con Map de Promises encadenadas (`syncLocksRef`). Dos `handleAddContacto`
   rápidos se serializan en lugar de duplicar eventos.
2. **`handleAddContacto` resincroniza siempre** (no solo si hay
   `agendadoPara`). Registrar "Rechazado" o "Contestador" ahora limpia la
   agenda anterior del prospect.
3. **`handleConvertirTareaAProspect`** borra el evento Google asociado a
   la tarea antes de eliminarla. Antes quedaba huérfano.
4. **Limpieza Google al borrar prospect** con rango amplio: `-10/+10 años`
   (antes `-2/+5`). Y `sincronizarSeguimiento` con `+10 años` para
   futuras agendas (antes `+6 meses`).

**Medios resueltos** (~10):
- `handleSaveAgenda` con prospect preserva el título del modal (antes
  siempre quedaba "Cita — nombre").
- `handleConvertirTareaAProspect` crea contacto inicial 'fecha_exacta' si
  la tarea tenía fecha → prospect queda con historial coherente.
- Detección de **eventos huérfanos** en `extractGcalEventsForCalendar`
  (`isOrphan = true` si tareaId no matchea state). Modal específico
  `OrphanEventModal` permite borrarlos desde Abordaje.
- `handleDeleteColumna` borra eventos Google de tareas dentro antes del
  cascade.
- `handleMoveTarea` valida que la columna destino exista.
- `handleMoveEvent` con rollback de Google si DB falla.
- `handleSaveAgenda` cierra modal aunque haya error (evita duplicación).
- **Migration**: `abordaje_tareas_columnas` ganó `actor_id` y `updated_at`.
  ActorStar funciona en headers de columnas Kanban (asistente que
  renombra/reordena queda marcado).
- `principalProfile` refresca al cambiar de tab — asistente detecta
  cuando el principal revoca `shares_calendar_with_assistant`.
- `actorMap` procesa `actorIds` de eventos Google (`extendedProperties`)
  → ActorStar muestra nombre real del asistente en eventos Google.
- `invalidateProfileCache()` en `SIGNED_OUT` — relogin con user distinto
  en la misma tab no usa cache stale.
- `buildEventKey` estable entre piloto on/off — overrides de color custom
  no se pierden al activar/desactivar Google Calendar.
- Modal de eliminar agenda (`ConfirmDeleteAgendaModal`) reemplaza
  `confirm()` nativo. Detecta serie recurrente y avisa.

## Bloque 4 — Auditoría 3: DB + bajos

**Migrations** aplicadas en Supabase:
- `add_actor_id_and_updated_at_to_abordaje_tareas_columnas`.
- `fix_search_path_is_assistant_of` (SECURITY DEFINER con
  `search_path = public, private` para cerrar attack surface).
- `drop_unused_calendar_sync_watches` (legacy del refactor viejo).

**Frontend bajos resueltos** (5):
- `AddColumnaModal` reemplaza el `prompt()` nativo del browser.
- Debounce 200ms en `buscarGlobal` + lazy fetches usan `debouncedQuery`.
- Búsqueda incluye observaciones de contactos (gestiones del historial).
- Banner sutil "Reconectar Google Calendar" cuando `gcalApi.list` devuelve
  skip (token expirado o revocado).

## Bloque 5 — Bug crítico de `syncLocksRef`

`syncLocksRef` quedó declarado en `BuscadorGlobal` en lugar de `App` por
error de Edit. `sincronizarSeguimiento` lo referenciaba desde el scope de
App → "Can't find variable: syncLocksRef" al registrar gestión. Movido al
scope correcto. Pusheado urgente.

## Bloque 6 — Timezone (+3hs)

Bug raíz reportado: registrar agendado para las 14hs aparece como 17hs en
lista y calendar (= 14 ARG + 3 = 17 UTC). Causa: múltiples lugares hacían
`new Date(...).toISOString()` que convierte a UTC. Reemplazado en:

- `buildGoogleEventBody`: usa nuevo helper `dateToGcalLocal(d)` que devuelve
  `YYYY-MM-DDTHH:MM:SS` en hora local (sin Z). Combinado con `timeZone:
  GCAL_TZ`, Google interpreta correctamente el instante en ARG.
- `handleMoveEvent` (drag de eventos en calendar): idem en update y rollback.
- `RegistrarGestion.confirmar`: cambió `.toISOString()` por local strings
  directos (`${fechaIso}T${hora}`) en los 3 branches (plazo, fecha,
  fechahora). Este era el bug principal — el flujo del prospect.
- `handleCreateTareaEnSlot` y `sincronizarSeguimiento` rama de crear tarea
  auto: también migrados a local strings.

Caveat: agendados creados antes del fix quedan en DB con la hora
desfasada. Para normalizar, editarlos manualmente.

## Bloque 7 — UX de inputs hora / fecha

Iteración larga sobre `HoraTexto`. Probadas varias versiones:
1. Predictivo custom (auto-format `:` mid-typing) — se sentía mágico.
2. Nativo `<input type=time>` — muestra AM/PM en browsers con locale 12hs,
   no se puede forzar 24hs desde HTML/CSS.
3. Custom 2 inputs (HH + MM) — funcional pero "interlineado feo".
4. **Versión final**: 4 slots de 1 dígito cada uno (`H H : M M`),
   visualmente unificados como un solo input con borde único. Auto-jump al
   siguiente slot SOLO al tipear dígito (no al borrar). Select-all on
   focus. Formato 24hs garantizado. Estilos compactos (`width: 1ch`,
   `gap: 0`).

`FechaTexto` se quedó con `<input type=date>` nativo (no tiene problema
de 12hs y el calendar nativo del SO es útil).

## Bloque 8 — UX general

- **Modal al clickear evento de prospect en calendar**: en lugar de abrir
  el panel directo, ofrece "Abrir ficha del prospect" o "Eliminar solo del
  calendar" (vacía `agendadoPara` del contacto manteniendo el registro en
  el historial; `deriveEstado` retrocede para que la etiqueta verde se
  actualice sola).
- **Modal propio al eliminar prospect** (`ConfirmDeleteProspectModal`)
  reemplaza el `confirm()` nativo. Muestra nombre, contacto, cantidad de
  gestiones, próxima cita. Texto neutro (sin callout rojo) por pedido del
  user.
- **Sticky footer en todos los modales**: `.modal` ahora es flex column
  con header fijo arriba, body scrolleable, footer fijo abajo. Aplica
  automáticamente a todos los modales sin tocar JSX individual.
- **TareaModal reorganizado**: Eliminar y Archivar al fondo del body
  (acciones secundarias). Cancelar/Convertir/Guardar en footer sticky
  (siempre visibles). Hora usa `HoraTexto` (no nativo).
- **Panel del prospect**: botón "Listo" verde → "Guardar" azul.
  "Cancelar" rojo → "Cancelar" secundario (blanco con borde azul).
  Coherente con el resto.
- **Agendas standalone en verde** (no celeste): `extractGcalEventsForCalendar`
  detecta `createdByAbordaje` via `abordaje_agente_id` tag de
  `extendedProperties`. Solo eventos del calendar personal sin tag de
  Abordaje son "external" (color de Google).
- **Slot click respeta `slotDurationMin`**: snap con `Math.floor` y
  `settings.slotDurationMin`. Click en cualquier pixel de una "celda
  visual" de hora devuelve el inicio de esa celda (antes click en el
  medio caía en X:30).
- **z-index del modal-backdrop**: subido a 400 para garantizar que un
  modal abierto sobre el panel lateral del prospect (z-index 200) quede
  por delante, no detrás.

## Cierre de la sesión
~25 commits, ~6 horas de iteración. El sistema quedó sin bugs de
timezone, sin race conditions de sync, con modales coherentes en todo el
proyecto, y UX de inputs hora/fecha resuelto con el formato custom de 4
slots que garantiza 24hs sin importar el browser/SO.
