# Tarea: Calendar sin duplicados en el MCP de Abordaje (y Universo)

## Objetivo

Una tarjeta de Abordaje (`abordaje_tareas`) debe tener **un solo evento en Google Calendar**, creado y mantenido por el servidor del MCP de Abordaje. Las reglas son iguales para todos los agentes y deben poder reutilizarse en Universo.

## Problema actual

- Abordaje crea solo un evento cuando la tarjeta tiene `fecha_recordatorio` y `hora_recordatorio`.
- Claude crea aparte, directo en Calendar, un evento de reunión (con Meet o invitados) para la misma tarjeta. Resultado: dos eventos.
- Cambios de fecha o de hora hechos por SQL directo no actualizan Calendar y dejan eventos viejos.

## Ya verificado (11/11/2026)

- La sincronización es inmediata: al cambiar la fecha por `update_tarea`, el evento se movió 2 segundos después.
- La tarjeta ya guarda `google_event_id` y la respuesta de `update_tarea` lo devuelve.
- La tarjeta ya tiene el campo `etiquetas`.

## Reglas generales

1. Un evento por tarjeta. Crear, mover, archivar o borrar la tarjeta actualiza ese mismo evento; nunca crea otro.
2. Un solo camino de escritura: los clientes MCP no crean eventos de tarjetas directo en Calendar; lo piden al MCP de Abordaje.
3. Cada tarjeta tiene un tipo: `recordatorio` (por defecto) o `reunion`.
4. Una reunión reemplaza al recordatorio: si la tarjeta es reunión, su único evento es el de reunión.
5. Los eventos creados a mano en Google Calendar no se vinculan ni disparan nada. Solo cuentan como horario ocupado. Se vinculan a una tarjeta solo si el usuario lo pide.
6. Cada agente elige en qué calendario se crean sus eventos (por defecto, el principal de su cuenta).
7. No se tocan eventos que no sean de Abordaje (por ejemplo, las reuniones que llegan por Soda, en verde).

## Cambios en el modelo de datos de `abordaje_tareas`

| Campo | Estado | Para qué |
| --- | --- | --- |
| `google_event_id` | Ya existe | Vínculo a su único evento |
| `etiquetas` | Ya existe | CUIDAR, BAJA, MANU TORRES, etc. |
| `tipo_evento` | Nuevo | `recordatorio` (default) o `reunion` |
| `con_meet` | Nuevo | Si la reunión lleva Google Meet |
| `invitados` | Nuevo | Emails a invitar |
| `duracion_min` | Nuevo | Duración del evento (hoy 60 por defecto) |
| `calendario_id` | Nuevo, por usuario | Calendario donde se crean sus eventos |

Además, guardar en el evento de Google, como propiedad privada (`extendedProperties.private`), el id de la tarjeta: `abordaje_tarea_id`.

## Comportamiento de las herramientas

| Acción | Qué hace con Calendar |
| --- | --- |
| `create_tarea` con fecha | Crea el evento y devuelve `google_event_id` y link en la misma respuesta |
| `update_tarea` (fecha, hora, título, tipo) | Actualiza el mismo evento. Si no existe, lo crea. Nunca crea uno nuevo si ya hay `google_event_id` |
| Pasar a `tipo_evento = reunion` | El evento pasa a azul, con Meet e invitados si se pidieron, y sigue siendo el único |
| Quitar la fecha | Borra el evento y limpia `google_event_id` |
| `archive_tarea` | Borra el evento |
| `delete_tarea` | Borra el evento (ya ocurre hoy) |
| `unificar_tareas` | Conserva un solo evento y borra el de la tarjeta eliminada |

Condiciones técnicas:

- **Respuesta completa:** toda herramienta que toca el evento devuelve su id y su link.
- **Idempotente:** el id del evento de Google se deriva del id de la tarjeta (el id de Google acepta solo `a-v` y `0-9`, entre 5 y 1024 caracteres; derivarlo con un hash en base32hex). Si dos procesos intentan crearlo a la vez, el segundo recibe 409 y debe reutilizar el existente, no crear otro.
- **Sin escrituras por fuera:** los cambios de fecha y hora van por el MCP o la app, no por SQL directo.

## Colores por tipo de evento

| Tipo | Color | `colorId` |
| --- | --- | --- |
| Recordatorio de Abordaje | Lila (Lavanda) | 1 |
| Reunión propia del agente | Azul (por defecto del calendario) | sin `colorId` |
| Reuniones de Soda | Verde; Abordaje no las crea ni las toca | — |

## Herramienta nueva: `reconciliar_calendar`

- `dry_run=True` por defecto: lista qué eventos son duplicados y cuál se conserva.
- Detecta por `abordaje_tarea_id`; si no lo tienen, por título parecido y mismo día y hora.
- Conserva el evento vinculado a `google_event_id`; si hay una reunión, conserva el azul y borra el de recordatorio.
- Borrar exige `confirmar=True` y avisa que no se puede deshacer.
- Opera solo sobre los eventos del propio usuario.

## Instrucciones del servidor (agregar al texto del MCP)

1. Para cualquier tarea con fecha, reunión o recordatorio: usar las herramientas de Abordaje. No crear eventos de tarjetas directo en Google Calendar.
2. Antes de agendar, buscar la tarjeta con `search_tareas`. Si existe, actualizarla; no crear una segunda.
3. Confirmar con la respuesta del MCP (`google_event_id` y link); no buscar en Calendar para verificar.
4. Si se agenda una reunión y ya había un recordatorio de la misma tarjeta, pasar la tarjeta a `reunion`; no dejar dos eventos.
5. Eventos que el usuario crea a mano en Calendar: leerlos solo para ver horarios ocupados. Vincularlos a una tarjeta solo si el usuario lo pide.
6. No usar SQL directo para cambiar fechas ni horas.

## Aplicación a Universo

Calendar pasa a ser un módulo compartido de Universo (Abordaje, PM personal, CRM). Mismo contrato: un vínculo por registro, tipo recordatorio/reunión, mismos colores, misma revisión de duplicados. El PM personal sigue solo para Nadir y se bloquea en el servidor por identidad. Cada agente usa su propio calendario y solo toca sus eventos.

## Orden sugerido de implementación

1. Campo `tipo_evento` y respuesta con id y link en todas las herramientas que tocan eventos.
2. Id de evento derivado del id de la tarjeta (anti-duplicado) y `abordaje_tarea_id` en el evento.
3. `con_meet`, `invitados`, `duracion_min`, `calendario_id` y colores por tipo.
4. `reconciliar_calendar`.
5. Actualizar las instrucciones del servidor.

## Pruebas de aceptación

- [ ] Crear una tarjeta con fecha y hora: queda 1 evento lila y la respuesta trae `google_event_id` y link.
- [ ] Cambiar fecha y hora por el MCP: el mismo evento se mueve en menos de 5 segundos, sin crear otro.
- [ ] Pasar la tarjeta a reunión con Meet e invitado: sigue 1 solo evento, azul, con Meet y el invitado.
- [ ] Dos llamadas simultáneas de creación para la misma tarjeta: queda 1 evento.
- [ ] Quitar la fecha, archivar o borrar la tarjeta: el evento desaparece.
- [ ] Unificar dos tarjetas con evento: queda 1 evento.
- [ ] `reconciliar_calendar` en simulacro sobre los datos actuales: lista los duplicados de la semana del 9 al 13/11 (Cassio, Hugo) sin borrar nada.
- [ ] Probar con dos usuarios distintos: cada uno ve y toca solo sus eventos, en su calendario.

---

## Estado de implementación (11/11/2026)

**Hecho y en producción (pasos 1 y 2 + parte del 3):**
- Migración `20261111171554_tareas_tipo_evento`: `tipo_evento`, `con_meet`, `invitados`, `duracion_min` en `abordaje_tareas`; `gcal_calendar_id` en `profiles` (el campo del documento `calendario_id`); el trigger `tareas_gcal_marcar` también marca pendiente si cambian esos campos.
- `supabase/functions/_shared/tarea_evento.ts`, usado por `gcal-events` (app y Universo) y `gcal-events-admin` (MCP). Todo evento con `abordaje_tarea_id`:
  - un "create" de una tarjeta que ya tiene evento actualiza ese evento (`reutilizado: true`);
  - id derivado `abt<uuid sin guiones>`: dos altas simultáneas dan un solo evento (409 → reutiliza); si ese id fue borrado, alta con id aleatorio;
  - recordatorio = colorId 1 (lila) al crear; reunión = color del calendario + Meet e invitados según la tarjeta; duración = `duracion_min`;
  - al actualizar una reunión no se toca un Meet existente ni se sacan invitados agregados a mano; mails solo para reuniones con invitados.
- `gcal-events-admin`: email de impersonación desde `auth.users` (sec-01).
- Prueba en producción (cuenta de Nadir, tarjeta de prueba borrada): 11/11 comprobaciones + 4 altas simultáneas → 1 evento.

**Limpieza 9-13/11:** 5 pares duplicados resueltos (se conservó la reunión, se borró el recordatorio) y 3 tarjetas desincronizadas re-alineadas.

**Diferencias con el documento:**
- No hace falta hash para el id: el uuid en hex ya es válido para Google. Google no deja reusar el id de un evento borrado; se resuelve con alta aleatoria (sigue sin duplicar porque la búsqueda por `abordaje_tarea_id` va primero).
- El color solo se pone al crear: si el usuario lo cambia en Google, se respeta.
- El duplicado que crea Claude con SU conector de Google Calendar no se puede bloquear desde el servidor: lo limpian las instrucciones del MCP y `reconciliar_calendar`.

**Falta:** paso 3 en el MCP (parámetros `tipo_evento`/`con_meet`/`invitados`/`duracion_min` en `create_tarea`/`update_tarea`, link en todas las respuestas), paso 4 (`reconciliar_calendar`), paso 5 (instrucciones del servidor), UI para elegir calendario y tipo en la app/Universo, y tarjetas sin hora como evento de día completo (propuesta).
