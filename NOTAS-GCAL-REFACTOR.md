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
