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

---

# Sesión 2026-05-22 — Performance + responsive header

## UI optimista al eliminar (prospect / tarea / agenda)

Antes, eliminar un prospect con Google Calendar activo podía bloquear la
UI 5-15 segundos: el `executeDeleteProspect` esperaba secuencialmente
`gcalApi.list(-10/+10 años)` + un delete por cada evento huérfano + el
delete de DB, todo antes de actualizar la pantalla. Para tareas y agendas
el delay era ~1-3s pero también notable.

Refactor a **UI optimista** en los 3 handlers:
- `executeDeleteProspect`, `handleDeleteTarea`, `handleConfirmDeleteAgenda`.
- Sacan el item del state Y muestran toast "Eliminado" **al instante**.
- La limpieza Google + delete DB se hace en background (IIFE async).
- Si algo falla, rollback al state previo + toast de error.
- En el prospect: deletes Google paralelizados con `Promise.all` (de
  N×latencia a 1×latencia cuando hay varios eventos huérfanos).

Trade-off aceptado: si Google/Supabase fallan, el item vuelve a aparecer
con un toast. La mayoría de los casos el user solo ve "Eliminado" al toque.

## Header mobile con nombres largos

Reportado: en la PWA mobile, perfiles con nombre largo (ej. "Federico Del
Boca") empujaban el botón "Salir" a una segunda línea, lo que aumentaba
la altura del header y escondía las tabs Lista/Tareas/Calendario.

Fix CSS puro en `@media (max-width: 720px)`:
- `.header-actions` con `flex-wrap: nowrap` (todo en una línea).
- `.header-actions > *` con `flex: 0 0 auto` (no se encogen).
- `.header-user` con `flex: 0 1 auto`, `max-width: 11ch`,
  `overflow: hidden`, `text-overflow: ellipsis`.

Resultado: el nombre se trunca con "…" según el ancho disponible. Salir,
Ajustes, ADMIN, campanita y tabs quedan siempre visibles. Aplica a
cualquier asesor con nombre largo (no es solo para Federico).

---

# Sesión 2026-05-26 — Quitar recordatorio + polish quick-date

## Botón "Quitar recordatorio" en TareaModal

Pedido: al editar una tarea, poder sacarle la fecha sin tener que ir al
campo de fecha y borrarla manualmente. Y de paso que se vaya el rojo de
"vencida" en la tarjeta del Kanban y el evento del calendar.

Implementación en `TareaModal`:
- Nuevo handler `quickQuitar` que llama `aplicarQuickDate(null, null)`.
  Reutiliza la rama existente de `handleUpdateTarea` que detecta
  `googleEventId && !hasFecha` y borra el evento Google automáticamente.
- 4º botón en `.quick-date-row` con clase `btn-quick-date muted`, visible
  solo cuando `form.fechaRecordatorio` existe (sino no tiene sentido).
- La tarea queda viva en el Kanban (sin color rojo, sin fecha), el evento
  desaparece del calendar, la bitácora se conserva.

## Polish de estilos quick-date

- Los 3 botones positivos (Hoy / Mañana / Próx semana): borde 1.5px (era
  1px), `font-weight: 700` (era 600), font-size 0.8rem (era 0.78). Más
  prominentes pero coherentes con el resto.
- "Quitar" con borde rojo sutil (`#dc2626`), fondo rojo claro
  (`rgba(220,38,38,0.04)`), texto rojo oscuro. Hover refuerza el rojo. Se
  diferencia de los positivos sin gritar "danger" porque la acción no es
  destructiva (la tarea sigue viva).

## Picker para mostrar/ocultar calendars de Google

Replica el checkbox que tiene Google Calendar para ocultar calendars
secundarios (compartidos, suscriptos) sin desuscribirlos. Pedido nacido
de tener compartido el calendar de Federico (socio) y querer poder
ocultarlo visualmente en Abordaje sin afectar la suscripción.

Implementación en `CalendarioView`:
- Nuevo botón "Calendarios" en la cabecera, junto a los sub-tabs Mes /
  Semana / Hoy. Solo aparece si hay más de un calendar detectado.
- Click → popover (`CalendarPicker`) con la lista de calendars únicos
  derivados de los eventos cargados (`gcalEvents` con `_gcalId`/
  `_gcalSummary`/`_gcalColor`/`_gcalPrimary` inyectados por la edge function).
- Cada item: checkbox + cuadradito de color (el de Google) + nombre.
  Primary primero, marcado como "principal" y deshabilitado para que el
  user no pueda ocultarlo (sino se pierden los eventos de Abordaje).
- Badge rojo sobre el botón con la cantidad de ocultos + opción "Mostrar
  todos" para resetear.
- Estado en `localStorage` key `abordaje_hidden_calendars` (Set de gcalId
  serializado). **Por device, no por user en DB**: es preferencia visual,
  no tiene sentido sincronizar.

**No toca Google**: solo filtra los `gcalEvents` antes de pasarlos a
`extractGcalEventsForCalendar`. El share del calendar sigue activo en
Google. Reversible al toque con el mismo checkbox.

---

# Sesión 2026-05-27 — Paleta extendida + actualización docs + compañías por tarea

## Paleta extendida (8 base + 8 claros)

`EVENT_COLOR_PALETTE` pasó de 8 a **16 colores**: los 8 originales saturados
(rojo, naranja, amarillo, verde, turquesa, azul, rosa, gris) + 8 variantes
claras del mismo tono. Render del picker en grid de 9 columnas (auto + 8
bases en una fila, 8 claros en otra). Sirve para distinguir dos calendars
del mismo "color" (ej. azul para el principal, azul claro para el de
Federico) en el override por calendar o el manual por evento.

## Modal de Instrucciones actualizado

Pasada general al texto del modal `InstruccionesModal` para reflejar lo
acumulado de las últimas semanas. Cambios principales:
- Sección 3 (Etiquetas): corrige la regla de color "amarillo para llamar_*"
  — hoy todas las tareas auto van en lila (regla `kind=tarea` gana).
- Sección 4 (Tareas): suma input de hora custom 24hs, botón "Quitar
  recordatorio", modal al eliminar con fecha, columnas sin tope en mobile,
  reorden de columnas con confirmación.
- Sección 5 (Calendario): expansión grande con modal al clickear evento
  de prospect, eventos huérfanos, paleta extendida, subsección dedicada
  al picker de calendarios (mostrar/ocultar + colores por calendar),
  banner de reconexión Google.
- Sección 9 (Atajos): búsqueda incluye gestiones, UI optimista al
  eliminar, sticky footer en formularios.

## Compañías por tarea (logo en card del Kanban)

Pedido: en algunas columnas del Kanban (típicamente "Ventas pendientes")
querer marcar a qué compañía corresponde cada tarea con el logo de la
aseguradora. Identificación visual rápida.

Implementación:
- **Migration**: `abordaje_tareas.compania text` (nullable).
- Constante `COMPANIAS` con 5 entradas: OLE, Investors Trust, Life Group,
  Best Doctors, Patrimonial. Las primeras 4 con logo PNG en `static/logos/`;
  Patrimonial sin logo propio (render como texto "PATRIMONIAL" en gradient
  azul IFS).
- `TareaCard`: click derecho (`onContextMenu`) abre popover con la lista
  de compañías + "Sin compañía". Selección actualiza al toque (optimistic
  UI) y persiste en DB en background.
- Logo se renderiza absoluto en la esquina superior derecha de la card
  (~18px alto, padding-right en el título para no solaparse).
- Solo en desktop (click derecho no existe en touch; long-press ya
  reservado para drag). Para mobile queda pendiente — opciones futuras:
  agregar selector en `TareaModal` (al editar) o un picker en long-press
  modificado.

## Fix: popover de compañía con createPortal

El popover se renderizaba dentro de la `.tarea-card` y deformaba el
layout cuando se abría (la card crecía al alto del popover). Causa:
algún ancestor con `transform` (drag context o grid Kanban) cambiaba el
stacking context y el `position: fixed` no se comportaba como tal.

Fix: `ReactDOM.createPortal(..., document.body)`. El popover se monta
fuera del árbol de la card, en `document.body`, y mantiene su position
fixed sin que ningún padre lo afecte.

---

# Sesiones 2026-05-29 a 2026-06-03 (reconstruido desde git log)

Entradas no registradas en su momento; detalle en los commits.

- **2026-05-29** — UX: pestañas Lista/Tareas/Calendario sticky bajo el
  header al scrollear.
- **2026-06-02** — Admin: FAB flotante "Abrir Claude Desktop" para
  mega-admin · panel de pagos de mantenimiento mes × agente con export
  PDF · fix: ordenar tildados antes que no-tildados, no cerrar panel
  con Escape.
- **2026-06-03** — Lista: solapa "Archivo" para archivar prospects sin
  perder info.

---

# Sesión 2026-06-11 — Auditoría general + Paquete 1 ("que no se pierda nada")

## Auditoría general del proyecto

Auditoría de solo lectura con 4 agentes en paralelo (seguridad, calidad de
código, performance, repo/deploy) + advisors oficiales de Supabase.
Resultado: lógica interna de calidad alta (RLS, rollbacks, timezone,
cleanups), sin secretos en el repo ni vectores XSS. Los hallazgos
importantes son operativos/estructurales, organizados en 5 paquetes:

1. **Que no se pierda nada** (ejecutado en esta sesión, ver abajo).
2. **Producción estable**: pinear CDNs (Babel carga *latest*), Cache-Control
   no-cache + APP_VERSION, fix TDZ de `tick` (~línea 5379), paginación de
   queries (Supabase trunca a 1.000 filas en silencio — `contactos` rompe
   primero), smoke test pre-push.
3. **Performance**: precompilar Babel en build de Railway (hoy compila
   ~470 KB de JSX en cada carga), doble fetch de gcal al entrar a
   Calendario, rango +10 años en sync de gestiones, RLS initplan
   (42 policies re-evalúan auth.uid() por fila).
4. **Pulido UX/código**: doble-submit en modales diarios, errores
   silenciosos de carga, "prospect"/"prospecto" mezclados en copy, 6
   confirm() nativos restantes, ~120 líneas de código muerto, htmlFor
   en labels, focus trap en modales.
5. **Refactor estructural**: App (~2.034 líneas) → custom hooks
   (`useGcalSync`, `useProspectos`, `useTareasKanban`, `useNotificaciones`,
   `useSettings`); eventual split del single-file con build step.

Hallazgos de seguridad puntuales pendientes: cualquier admin puede resetear
password/email del megaadmin (falta guard en `update-user-password`/`-email`),
CORS `*` en edge functions, comparación no constante del service-role en
`gcal-events-admin`, Leaked Password Protection apagada.

## Paquete 1 ejecutado

- **Backup semanal automático de la DB**: `scripts/backup-db.sh` (pg_dump
  vía session pooler, password en Keychain) → iCloud
  `IFS/Backups Abordaje DB/`, retención 90 días, launchd lunes 10:00.
  Primer backup verificado (40 tablas, integridad OK). Detalle y nota
  TCC/macOS en STATE.md.
- **Edge functions versionadas**: las 8 funciones descargadas del remoto
  a `supabase/functions/` (incluida `gcal-events-admin`, que no estaba
  documentada). Convención nueva: editar local → deployar.
- **Schema baseline**: `supabase/schema_baseline.sql` (schema-only de
  public/private/comisiones/patrimoniales, 16 tablas + 47 policies) —
  reemplaza la historia de migrations viejas que solo vivía en el remoto.
- **`.gcp-sa-key.json` local borrado**: la clave DWD vive como secret
  `GOOGLE_SA_KEY` en Supabase (verificado); la copia en iCloud era
  redundante y nunca estuvo commiteada.
- **Docs al día**: STATE.md (estado 2026-06-11, features de junio, tabla
  de edge functions con versiones reales, sección Backups) y
  `supabase/README.md` (referencia rota a NOTAS-GCAL-REFACTOR.md
  reemplazada por el baseline).

---

# Sesión 2026-06-11 (cont.) — Paquete 2: producción estable

Cinco cambios quirúrgicos en index.html + infra de validación. Verificado:
`npm run check` OK (JSX compila con el Babel real), build local servido y
header de cache confirmado con curl. Sin cambios de comportamiento para el
user con los volúmenes actuales de datos.

- **CDNs pineados**: react/react-dom 18.3.1, @babel/standalone 7.29.7,
  supabase-js 2.108.1 (las versiones exactas que producción servía hoy —
  cero cambio de runtime). Antes Babel cargaba *latest* en cada visita:
  un release con breaking change rompía producción sin tocar nada.
- **Fix TDZ de `tick`**: el useMemo de notificaciones usaba `tick` en deps
  ~50 líneas antes de su declaración. Funcionaba solo porque preset-env
  convierte const→var. Movido arriba; deja el código listo para un futuro
  build step sin preset-env.
- **`selectAllRows()`**: helper de paginación en la capa de datos. Supabase
  trunca a 1.000 filas sin error; las 6 queries de loadState +
  listTareasArchivadas ahora paginan con .range() hasta agotar. Con <1.000
  filas hace exactamente 1 request (comportamiento idéntico al actual).
- **`APP_VERSION`** ('2026-06-11') visible en el footer del login.
  Convención: bumpear en cada deploy.
- **Cache-Control no-cache** para index.html vía `serve.json` (el build lo
  copia a public/). Antes el caching heurístico podía servir versiones
  viejas días después de un deploy.
- **`npm run check`** (scripts/check.mjs + devDependency @babel/standalone
  pineada): compila el bloque text/babel y falla si hay error de sintaxis.
  Hook pre-push local instalado; procedimiento de rollback documentado en
  STATE.md.

---

# Sesión 2026-06-11 (cont. 2) — Paquete 3: performance

Probado por Nadir en local contra la base real antes del push: arranque
notablemente más rápido, todas las vistas idénticas, consola limpia.

- **Precompilación en build** (`scripts/build.mjs`): npm run build compila
  el bloque JSX con @babel/standalone 7.29.7 + presets react/env (la misma
  config que aplicaba el browser → JS resultante idéntico) y sirve
  public/index.html sin Babel CDN. El browser se ahorra ~3 MB de descarga
  de Babel y 1,5-15 s de compilación EN CADA visita. El index.html del repo
  no cambia de formato (single-file, editable, corre sin build).
  @babel/standalone pasó de devDependencies a dependencies para garantizar
  que Railway lo tenga en el build.
- **Fix doble fetch de Google Calendar**: el refresh por cambio de pestaña
  bumpeaba gcalReloadKey justo cuando CalendarioView recién montaba y ya
  fetcheaba por su cuenta → dos invocaciones idénticas de gcal-events por
  cada entrada a la pestaña. Ahora el bump se saltea al entrar a calendario.
- **Cache stale-while-revalidate del calendario** (`_gcalViewCache`, Map a
  nivel módulo, key timeMin|timeMax): al volver a la pestaña Calendario (o a
  una semana ya visitada) los eventos se pintan al instante desde el cache
  mientras el fetch a Google refresca en background. Se invalida si la edge
  function responde skip (token revocado). Antes: calendario vacío durante
  el round-trip completo a Google en cada entrada.
- APP_VERSION → 2026-06-11.2.

---

# Sesión 2026-06-12 — Paquete 4: pulido UX, copy y seguridad

## Frontend (index.html)
- **Anti doble-submit** en los 3 modales de uso diario (NuevoProspectoModal,
  TareaModal, EditAgendaModal): estado `saving`, botón deshabilitado con
  "Guardando…" mientras corre el save. Evita prospectos/updates duplicados
  por doble Enter o doble tap. (NuevaAgendaModal ya lo tenía.)
- **Copy unificado "prospecto"**: eliminado el spanglish "prospect" de todo
  el texto visible (toasts, títulos de modales, botones, tooltips,
  aria-labels y las ~19 menciones del modal de Instrucciones). Los nombres
  de variables/funciones internas no se tocaron.
- **Aviso de carga parcial**: si alguna de las 6 queries del load falla,
  loadState marca `cargaParcial` y la UI muestra toast "No se pudieron
  cargar todos los datos — recargá la página". Antes: listas vacías en
  silencio. Igual para el refresh por cambio de pestaña.
- **Profile fetch sin catch vacío**: si falla la carga del perfil en
  AppShell ahora hay console.error + toast con instrucción de recargar.
- **Modal propio para eliminar gestión** (`ConfirmDeleteContactoModal`):
  reemplaza el último confirm() nativo de flujo diario. Patrón
  `pendingDeleteContacto` + `opts.confirmed` en handleDeleteContacto.
  Quedan confirm() nativos solo en flujos de admin (aceptado).
- **Código muerto eliminado** (~90 líneas): newProspecto, newTarea,
  newColumna, reordenarColumnas, parseFechaFlex, isoToDDMMYY,
  isoToDDMMYY8, dateToDDMMYYYY y calendarApi.remover — legacy de la era
  localStorage / inputs de tipeo predictivo. Verificado 0 referencias.
- APP_VERSION → 2026-06-12.

## Edge functions (deployadas al remoto)
- **Guard anti-escalada** en `update-user-password` (v8) y
  `update-user-email` (v6): un admin NO puede cambiar el password/email de
  OTRO admin — solo el megaadmin. Cierra el hallazgo de la auditoría
  (un admin secundario podía resetear la cuenta del megaadmin y tomar
  control). Cambiarse a sí mismo sigue permitido.

## Pendiente del paquete 4 (consciente)
- Accesibilidad fina: htmlFor en ~59 labels, focus trap en modales,
  alternativa de teclado para drag & drop. Baja prioridad para el equipo
  actual.

---

# Sesión 2026-06-12 (cont.) — Relevamiento de necesidades ("8+1") en la ficha

Feature pedida por las capacitaciones de agentes nuevos: formulario de
relevamiento de necesidades por prospecto, basado en el "8+1 y FF" de Life
(PDF fuente en la carpeta del proyecto, sin trackear).

- **DB**: columna `abordaje_prospectos.relevamiento jsonb` (migración
  `20260612170000`). Schema versionado en el frontend (`{ v: 1, ... }`),
  null = nunca relevado. RLS: viaja con las policies existentes de la tabla.
- **Capa de datos**: `relevamiento` agregado a PROSPECTO_COLS, al mapper y
  a `updateProspecto`. La persistencia reusa `upsertProspecto` (optimistic
  + rollback).
- **UI**: en la ficha (entre Historial y Datos) un lanzador con resumen
  ("X de 8 bloques con datos") y botón "Iniciar/Abrir relevamiento" → modal
  a casi pantalla completa (min(1100px, 96vw) × 94vh, portal a body por el
  transform del panel). Adentro, 8 bloques SIEMPRE abiertos (sin acordeón,
  pedido de Nadir): grupo familiar (edad auto-calculada desde fecha nac.),
  educación por hijo (5 etapas × costo/cuotas/años), mantenimiento y
  vivienda en par, otras necesidades (las 7 del PDF), ingresos y pensión
  (régimen/categoría como selects), seguros existentes e info adicional en
  par, y "+1 Nota libre" al final. Switch ARS/USD arriba (las etiquetas de
  costo muestran la moneda elegida).
- **Autosave on-blur** con acumulador (`pendingRef`); acciones estructurales
  (agregar/quitar filas, selects, moneda) persisten al instante. readOnly
  (admin "Ver como") deshabilita todo.
- **Mobile**: modal pantalla completa, filas colapsan a 2 columnas,
  inputs 16px (evita el auto-zoom de iOS), labels largos a ancho completo.
- Decisiones de adaptación del PDF: "Datos de contacto" y "Life Advisor/
  Agencia/Fecha" no se duplican (ya están en la ficha / el user logueado);
  terminología "agente/asesor"; Esc cierra solo el modal (guard en el panel).
- APP_VERSION → 2026-06-12.2.

---

# Sesión 2026-06-12 (cont. 2) — PDF del relevamiento (v1)

- Botón "Descargar PDF" en el header del modal de relevamiento →
  `exportarRelevamientoPDF(prospecto)`: A4 vertical, header navy con logo
  IFS (reusa `loadIFSLogoPNG`), una tabla autoTable por bloque con datos,
  bloques vacíos listados en gris al pie, moneda elegida en los headers de
  costo, edad calculada impresa, nota libre como párrafo, footer
  "Confidencial" + paginado. Archivo: `IFS_Relevamiento_<nombre>_<fecha>.pdf`.
- **Pendiente declarado por Nadir: pulir el diseño del PDF** (tipografías,
  espaciados, quizás layout más cercano al folleto original de Life).
  La v1 es funcional para que los agentes empiecen a usarla.
- APP_VERSION → 2026-06-12.3.

---

# Sesión 2026-06-12 (cont. 3) — Safe areas del modal de relevamiento en mobile

- En PWA standalone (iOS, viewport-fit=cover) el header del modal de
  relevamiento quedaba tapado por el notch. Fix: `env(safe-area-inset-*)`
  en el head (top/left/right) y en el padding inferior del body (barrita
  del home), solo en el media query mobile. APP_VERSION → 2026-06-12.4.

---

# Sesión 2026-06-12 (cont. 4) — Instrucciones al día

- Nueva sección **"3. Relevamiento de necesidades (formulario 8+1)"** en el
  modal de Instrucciones (cómo abrirlo, los 8 bloques + nota libre, switch
  de moneda, autosave, chips de avance, edad automática, PDF, uso mobile).
  Secciones siguientes renumeradas 4-11; referencia cruzada "(ver sección
  5)" → "(ver sección 6)" actualizada.
- Sección Etiquetas: nota de que las gestiones del historial se editan o
  eliminan con confirmación por modal.
- Sección Calendario: ítem sobre la carga instantánea al volver a la
  pestaña (cache + refresh en background).
- Sección Atajos: tres ítems nuevos — botones "Guardando…" sin duplicados,
  aviso de carga parcial, y versión visible en el login para reportes.
- APP_VERSION → 2026-06-12.5.
