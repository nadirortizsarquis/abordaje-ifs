# Integración Abordaje → CRM IFS Broker (bitácora de clientes)

Estado: **IMPLEMENTADO Y EN PRODUCCIÓN** (ago 2026). Lo que sigue fue el spec de diseño;
el cuerpo detallado puede tener matices respecto de lo finalmente construido, pero la
integración YA ESTÁ LIVE. Resumen de lo implementado:
- Botón **"Convertir a cliente CRM"** (`CrmVinculoLanzador`) en prospecto, tarea, agenda
  y cita de calendario. Modal: busca por DNI, vincula o **crea** el cliente (opt-in, con
  DNI+nombre+apellido obligatorios), y vuelca la gestión a la bitácora del cliente.
- Typeahead **"Cliente en el CRM"** (`CrmClientePicker`) al crear prospecto/tarea.
- **Ancla por cliente** (`crm_client_id` en prospecto y a nivel ítem para tareas/agendas
  sueltas). El `sync` junta todo lo que apunte al mismo cliente.
- Gating por asesor: `advisors.crm_sync_enabled` (default OFF; admins habilitados por rol).
  Enforced **server-side** en la edge function `crm-sync` (ops search/lookup/create/sync;
  403 si no está habilitado; `lookup` vacío para no-admin).
- Conecta al CRM Django de Bruno (TokenAuthentication). Migraciones:
  `20260813120000` (foundation), `20260819120000` (ancla por ítem), `20260820140000`
  (flag `crm_sync_enabled`). PM #819.

> **Actualización 13/08/2026 (Nadir).** Se retomó el tema y se cargó al PM como
> tarea **#819** (proyecto Abordaje). Dos precisiones que **superan** lo que decía
> este doc:
> 1. **Creación opt-in habilitada.** La decisión previa "cliente inexistente → solo
>    avisar, no crear" queda superada: ahora, si no hay match, se avisa "no encontrado"
>    y se ofrece un botón explícito **"Crear en el CRM"** que el asesor decide apretar
>    (nunca automático). Ver §13.
> 2. **Obligatorios del modal:** `DNI` + `nombre` + `apellido` (el resto opcional).
>    El DNI se captura en el modal porque el prospecto no tiene ese campo hoy.
>
> Las 3 definiciones pendientes de Bruno viven ahora en la descripción de la tarea
> #819 (sección "DEFINICIONES PARA BRUNO"). Habilitar la creación vuelve la
> atribución de asesor (`primary_advisor`/`created_by`) un requisito **bloqueante**,
> no opcional.

## 1. Objetivo

Migrar, a demanda y sin perder datos, el historial de un prospecto de Abordaje hacia la
bitácora del cliente en el CRM de Bruno. Un botón por prospecto; una sola dirección
(Abordaje → CRM); nunca borra ni pisa datos del CRM, solo **agrega** entradas.

## 2. Hallazgos del relevamiento (fuente de verdad)

### CRM (Bruno) — `~/Projects/erp-ifs/ifs-broker-api`
- Modelo `ClientLog` (apps/clients/models.py): bitácora libre por cliente.
  Campos: `client`, `description`, `created_by`, `quote_ref`, `task_ref`, `created_at`, soft-delete.
- Crear entrada: `POST /clients/{id}/log/` con `{ "description": "..." }`. (Leer: `get_client_log`.)
- `document_number` del cliente = texto libre (DNI, pasaporte, CUIT, con guiones). Requiere normalizar.
- Límites: (a) `created_by` = siempre el usuario que ejecuta (no atribuible al asesor original);
  (b) `ClientLog` NO tiene referencia externa (no-duplicación la maneja Abordaje).

### Abordaje — Supabase (ref hxjpnekzncqepbhpdkfv)
- `abordaje_prospectos` (unidad que mapea 1:1 al cliente CRM). Hoy identifica por nombre + teléfono.
  **No existe campo documento/DNI.**
- `abordaje_prospecto_contactos` → gestiones (tipo, fecha, hora, observacion). Cuelga del prospecto.
- `abordaje_agendados` → citas agendadas (fecha, nota). Cuelga del prospecto.
- `abordaje_tareas` → tarjetas kanban (titulo, observacion, columna_id, compania, fecha_recordatorio).
  **Solo guarda la columna ACTUAL, no el historial de movimientos.**

## 3. La llave de match (cliente exacto)

No confiar en el DNI en cada envío: fijar el vínculo una vez y guardarlo.
- Primera vez: buscar en el CRM por `documento` (o nombre/teléfono) → candidatos.
- 1 resultado → confirmar. Varios/dudoso → mostrar candidatos (nombre + doc) y **el humano elige**.
  Cero match automático ambiguo.
- Al confirmar se guarda `crm_client_id` en el prospecto. Desde ahí, todo va a ese id fijo.

## 4. Idempotencia (evitar duplicados)

Control del lado Abordaje (fuente de verdad de "qué ya mandé"):
- Cada ítem enviado guarda `crm_log_id` + `crm_synced_at`.
- El botón solo envía ítems con `crm_synced_at` NULL. Reapretar / doble-click = no reenvía.

Endurecimiento implementado (ago 2026, auditoría Fase 1):
- **create dedup por documento**: antes del POST, `crm-sync` hace `GET /clients/?document_number=<normDoc>`; si ya existe, devuelve **409 `duplicate_document` + candidatos** y el front ofrece VINCULAR en vez de crear un duplicado. `force:true` lo saltea (documentos legítimamente repetidos).
- **normDoc alineado front + edge**: el documento se normaliza (saca puntos/espacios/guiones) en el dedup de prospectos, en el lookup y en el create → "12.345.678" y "12345678" matchean el mismo cliente.
- **fail-closed en `link` y en el dedup de `create`**: si el CRM no responde (5xx/timeout), NO se fija el vínculo ni se crea a ciegas; se pide reintentar.
- **sync bloqueado tras `synced_unmarked`**: si el log entró al CRM pero el stamp local falló, el botón "Sincronizar" queda deshabilitado (reintentar duplicaría); se destraba reabriendo el modal.
- **aviso `multi_prospecto`**: si varios prospectos apuntan al mismo `crm_client_id`, `status`/`sync` lo marcan y el front avisa que se vuelca la gestión de todos.

Pendiente del lado CRM (Bruno, PM #881): `source`/`source_id` + índice único en `ClientLog` para idempotencia dura server-side (que un reintento de red nunca duplique el log aunque el stamp de Abordaje falle).

## 5. Fuentes y etiquetado de entradas

Cada entrada migrada se prefija según origen, para que la bitácora del CRM se lea clara:

| Fuente Abordaje | Etiqueta en CRM |
|---|---|
| `abordaje_prospecto_contactos` | `[Gestión · {fecha} · {tipo}]` |
| `abordaje_agendados` | `[Agenda · {fecha}]` (cuándo hubo reunión agendada y cuándo no) |
| `abordaje_tareas` | `[Tarea · {columna actual} · {compañía}]` |

Formato del cuerpo (preserva autor y fecha reales, ya que `created_by` no es customizable):
```
[Gestión · 14/07/2026 10:30 · Llamada · Federico]
{observacion}
```
Opcional: una entrada-resumen inicial ("Prospecto trabajado desde X · N gestiones · N agendas · estado actual").

## 6. Arquitectura

- **Supabase Edge Function** (infra que Abordaje ya tiene). Lee los ítems no-sincronizados del
  prospecto, llama al REST del CRM **server-to-server** con credencial de servicio, registra sync.
- El botón en Abordaje solo dispara la función. Nunca desde el navegador (secretos/auth server-side).
- **Independiente del MCP**: los agentes NO necesitan MCP. El que habla con el CRM es la Edge Function
  vía API REST con un token de servicio único.

## 7. UX del botón

En el **prospecto** (las gestiones cuelgan del prospecto, no de la tarjeta).
- Precondición: documento cargado / match confirmado.
- Muestra: cliente CRM matcheado, "N ítems nuevos a enviar", confirmar.
- Después: "N enviados · última sync {fecha}". Match ambiguo → lista de candidatos.
- Granular por prospecto (más seguro y auditable que masivo).

## 8. Cambios de datos (todos aditivos, no rompen nada)

| Sistema | Cambio | Rompe algo |
|---|---|---|
| Abordaje | +`documento` (text), +`crm_client_id` (int) en `abordaje_prospectos` (nullable) | No |
| Abordaje | +`crm_log_id`, +`crm_synced_at` (nullable) en cada tabla-fuente (contactos, agendados, tareas) | No |
| Abordaje | Edge Function nueva + botón en el prospecto | No |
| CRM | Ninguno obligatorio (usa endpoint existente). Opcional: `source`/`source_id` en `ClientLog` | No |

## 9. Garantías de "no romper nada"

- Una sola dirección (Abordaje → CRM). Nunca borra ni pisa: solo agrega bitácora.
- Todo aditivo: columnas nuevas nullables, RLS intacto, nada existente cambia.
- Idempotente: re-ejecutar solo trae lo nuevo. Snapshot al enviar (editar en Abordaje no repropaga).
- Orden cronológico al enviar. Se saltean entradas vacías.
- Volumen chico (hoy ~59 prospectos / ~71 gestiones): priorizar simple y robusto.
- Lado CRM: usa endpoint existente; si se suman campos opcionales, va por el flujo normal de Bruno
  (branch → PR → él mergea), sin tocar su lógica de negocio.

## 10. Consideraciones / riesgos a cuidar

- **Historial de columnas NO existe**: solo se puede migrar la columna actual de la tarjeta.
  Si se quiere el recorrido, primero hay que loguear movimientos (cambio aparte, a futuro).
- **Privacidad**: el `relevamiento` (datos familiares/financieros) NO se vuelca por defecto.
  Solo `notaLibre` si se pide explícitamente.
- **Prospectos duplicados** en Abordaje apuntando al mismo `crm_client_id`: detectar y avisar.
- **Autoría**: todas las entradas quedan como el usuario de servicio → conviene un usuario dedicado
  "Abordaje Sync" en el CRM para que el origen sea claro.

## 11. Lo que necesitamos de Bruno

1. Credencial de servicio para autenticar la Edge Function contra el REST del CRM.
   Ideal: usuario dedicado "Abordaje Sync".
2. Confirmar endpoint REST de búsqueda de clientes (match por documento/nombre) y que
   `POST /clients/{id}/log/` sea accesible server-to-server.
3. (Opcional) Campos `source`/`source_id` + índice único en `ClientLog` para blindaje extra.

## 12. Fases sugeridas

1. Abordaje: migración aditiva (columnas documento / crm_client_id / tracking de sync).
2. UI: campo documento + flujo de match-y-confirmar en el prospecto.
3. Edge Function: envío incremental con etiquetado por fuente.
4. Botón + estados (enviar / última sync).
5. (Con Bruno) credencial + opcional blindaje `source_id`.
6. Pruebas end-to-end con 1-2 prospectos reales antes de habilitar general.

Nada de esto entra al PM hasta que el diseño esté cerrado y validado.

## 13. Decisiones confirmadas (Nadir)

- **Asistentes NO pueden apretar el botón** (solo asesor/admin; enforced por RLS + UI).
- **Cliente inexistente en el CRM → aviso + creación opt-in** (actualizado 13/08/2026,
  supera la decisión previa de "solo avisar"). Si no hay match, se muestra "no encontrado"
  con un botón explícito **"Crear en el CRM"** que el asesor decide apretar; nunca se crea
  automático. Crear implica resolver la atribución de asesor (ver §2 y §11).
- **Se puede desvincular** un match (`crm_client_id` → null y re-linkear). Lo ya enviado se
  borra a mano en el CRM (queda trazado por `crm_log_id`).
- **Botón deshabilitado mientras corre** (evita doble ejecución; complementa el flag por ítem).
- **Todas las validaciones de seguridad viven en Abordaje.** Al CRM de Bruno: cero cambios de
  esquema y cero riesgo — solo lectura (búsqueda/match) + append vía el endpoint existente
  `POST /clients/{id}/log/`. Nada puede romper ni alterar datos del CRM.

## 14. Otras consideraciones operativas (fase implementación)

- Fallo parcial / reintentos: enviar ítem por ítem, marcar sync solo tras `201`; reintentable.
- Fecha/zona horaria fijada en hora Argentina.
- Concurrencia cubierta por flag por ítem + botón deshabilitado.
- Probar en staging con 1-2 prospectos antes de habilitar general. Nunca la primera prueba
  contra la base real de Bruno.
