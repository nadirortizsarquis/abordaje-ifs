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
