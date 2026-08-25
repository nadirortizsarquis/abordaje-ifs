export const meta = {
  name: 'auditar-abordaje',
  description: 'Auditoría exhaustiva e independiente de Proyecto Abordaje + flujo CRM: sync, RLS, consistencia, flujo, perf y sugerencias',
  whenToUse: 'Cuando Nadir pida una revisión integral/objetiva de Abordaje (bugs, sincronización, seguridad, consistencia, flujo CRM) o llevarlo a "primer nivel". Palabra clave: "auditar-abordaje".',
  phases: [
    { title: 'Revisar', detail: '8 reviewers independientes por dimensión' },
    { title: 'Verificar', detail: 'skeptic adversarial por bug concreto' },
    { title: 'Sintetizar', detail: 'informe priorizado + roadmap' },
  ],
}

const ROOT = "/Users/nadirortiz/Library/Mobile Documents/com~apple~CloudDocs/IFS/CLAUDE/Proyecto Abordaje"

const COMMON = `
Estás auditando "Proyecto Abordaje", una app de planificación para asesores de seguros de IFS.
Arquitectura: un unico archivo ${ROOT}/index.html (React via CDN + Babel standalone, ~683KB / miles de lineas),
backend Supabase (Postgres + RLS + Edge Functions Deno en ${ROOT}/supabase/functions/, migraciones en ${ROOT}/supabase/migrations/),
Auth Google OAuth, deploy Railway (push a main = auto-deploy). Hay docs en ${ROOT}/docs/ y ${ROOT}/STATE.md.
El CRM es un sistema Django aparte (de Bruno) en ~/Projects/erp-ifs/ifs-broker-api (READ-ONLY, no proponer cambios de logica de negocio ahi, solo del lado Abordaje).

Modelo de datos clave: un prospecto tiene "contactos" (gestiones). El ULTIMO contacto define estado + proximoContacto + genera UN artefacto
(agendado -> agenda; si tiene agendadoPara -> tarea; si no, nada). '_syncSeguimientoBody' hace delete-and-recreate (invariante: la tarea espeja el ultimo contacto).
Hay sync inverso tarea->prospecto ('_syncTareaAProspecto', tipo 'recordatorio' violeta). "Piloto" (isPilot) = Google Calendar activo.
El "contacto canonico" del CRM excluye tareas/agendas ligadas a prospecto (solo se vuelca el contacto real).

REGLAS DE LA AUDITORIA:
- Sé objetivo, escéptico y exhaustivo. Buscá fallas REALES, no teóricas de manual.
- Toda afirmación debe tener evidencia: archivo + numero de linea + snippet corto. Si no podés ubicarlo en el código, no lo reportes como bug (marcalo como "sugerencia" o "a-verificar").
- El archivo index.html es enorme: usá Grep para localizar por nombre de funcion/simbolo antes de leer, no lo leas entero.
- Distinguí severidad honestamente. No infles. Un "podria mejorarse" no es "critical".
- Además de bugs, proponé mejoras concretas para llevar Abordaje a nivel profesional de primer nivel.
`

const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dimension", "resumen", "findings"],
  properties: {
    dimension: { type: "string" },
    resumen: { type: "string", description: "2-4 frases: estado general de esta dimensión" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "titulo", "tipo", "severidad", "evidencia", "impacto", "recomendacion"],
        properties: {
          id: { type: "string", description: "slug corto unico, ej sync-01" },
          titulo: { type: "string" },
          tipo: { type: "string", enum: ["bug", "sincronizacion", "inconsistencia", "seguridad", "performance", "ux", "sugerencia", "deuda-tecnica"] },
          severidad: { type: "string", enum: ["critical", "high", "medium", "low", "sugerencia"] },
          evidencia: { type: "string", description: "archivo:linea + snippet corto que lo prueba" },
          impacto: { type: "string" },
          recomendacion: { type: "string" }
        }
      }
    }
  }
}

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "veredicto", "razonamiento", "severidad_corregida"],
  properties: {
    id: { type: "string" },
    veredicto: { type: "string", enum: ["confirmado", "refutado", "incierto"] },
    razonamiento: { type: "string", description: "qué verificaste en el código y por qué el veredicto" },
    severidad_corregida: { type: "string", enum: ["critical", "high", "medium", "low", "sugerencia"] }
  }
}

const DIMENSIONS = [
  {
    key: "sync-core",
    prompt: `DIMENSION: Motor de sincronización prospecto <-> contacto <-> tarea <-> agenda <-> Google Calendar.
Auditá los invariantes de sync. Anclas para Grep en index.html: _syncSeguimientoBody, _syncTareaAProspecto, _runLockedProspecto, deriveEstado, rehydratePolicy, extractCalendarEvents, extractGcalEventsForCalendar, tipoEvento, add_contacto, proximoContacto, agendadoPara, recordatorio.
Buscá: race conditions, orden de operaciones, casos donde la tarea NO refleja el ultimo contacto, sync inverso que pisa datos, campos de fecha que no se rehidratan (timezone/Date), doble creacion o borrado de eventos GCal, derivacion de estado incorrecta, el fix de piloto (eventos gcal con tipoEvento). Verificá que el delete-and-recreate no pierda datos.`
  },
  {
    key: "crm-flow",
    prompt: `DIMENSION: Flujo de integración con el CRM (edge function). Leé COMPLETO ${ROOT}/supabase/functions/crm-sync/index.ts y ${ROOT}/docs/INTEGRACION_CRM.md.
Auditá ops: search, lookup, create, sync, link, verify_advisor. Buscá: idempotencia (reintentos que duplican logs/clientes), manejo de errores/timeouts, gating crm_sync_enabled server-side (403), scoping advisor_email (fuga de clientes ajenos), "contacto canonico" (que NO se vuelquen tareas/agendas de prospecto), stamp de estado tras volcar, validacion de existencia en link, exposicion de tokens/secretos, consistencia del mapeo prospecto<->crm_client_id. Contrastá el codigo real contra lo que dice INTEGRACION_CRM.md.`
  },
  {
    key: "rls-seguridad",
    prompt: `DIMENSION: Seguridad, RLS y permisos. Leé TODAS las migraciones en ${ROOT}/supabase/migrations/ y revisá auth en las edge functions de ${ROOT}/supabase/functions/.
Buscá: policies sin WITH CHECK, recursion 42P17 (policy que consulta su propia tabla), uso incorrecto de service_role, SECURITY DEFINER sin search_path fijo o sin validacion, fugas de datos entre asesores (produccion, calendario de pagos, meetings, prospectos), flags de acceso (ole_ver_produccion, ole_ver_calendario_pagos, compartir_calendario, crm_sync_enabled) enforced solo en UI y no en RLS, bucket ole-reportes storage RLS. Priorizá cualquier via de acceso a datos de otro usuario.`
  },
  {
    key: "consistencia-ui",
    prompt: `DIMENSION: Consistencia UI/UX entre las 3 solapas (Lista de Abordaje, Tareas, Calendario) + estados + colores + CRM launcher.
Anclas: estados de prospecto (nuevo/pendiente/programado/agendado/rechazado), TIPOS_CONTACTO, mapas de color (CAL_COLOR_*, EVENT_COLOR_PALETTE), mensaje_sin_respuesta gris, recordatorio violeta, CrmVinculoLanzador, CrmClientePicker.
Buscá: mismo dato mostrado distinto en cada solapa, colores inconsistentes o que chocan con calendarios externos, estados que no matchean entre lista y calendario, labels/copy divergentes, comportamiento del launcher CRM segun contexto (prospecto/tarea/agenda/cita), responsive/mobile roto en lo nuevo. Enfoque de producto: qué rompe la sensacion de "app de primer nivel".`
  },
  {
    key: "calendarios-compartidos",
    prompt: `DIMENSION: Calendarios compartidos + meetings + invitaciones.
Anclas: shared-calendar (edge function), abordaje_calendar_shares, abordaje_calendar_meetings, abordaje_calendar_meeting_invites, MeetingInviteSection, CalendarioCompartidoView, source_ref, busy, is_meeting_invitee.
Buscá: duplicacion de eventos espejo, invitaciones que no idempotan (source_ref), fuga de titulos/datos en modo "ocupado" (deberia ser anonimo), lifecycle de invites (pending/accepted/declined) inconsistente, el badge (N) mal contado, meetings que aparecen duplicados en el calendario normal al aceptar, RLS de INSERT...RETURNING. Verificá que "ocupado" nunca exponga contenido.`
  },
  {
    key: "calendario-pagos",
    prompt: `DIMENSION: Calendario de pagos (renovaciones OLE auto + pagos manuales Investors Trust).
Anclas: CalendarioPagosOLE, PagoManualModal, CalpagoEditModal, abordaje_pago_manual, ole_reportes.resumen.cartera, buildMonthGrid, dayKey, frecuencia (ANNUAL/MONTHLY/SEMIANNUAL/QUARTERLY), savePagoManual, ole_poliza_pago.
Buscá: derivacion de cuotas por frecuencia incorrecta (semestral/trimestral/mensual), fallback cartera->detalle, fechas vencimiento DD/MM/YYYY mal parseadas, mezcla OLE + manual con _compania, matching cliente, persistencia del "quien paga"/observaciones, colapso Nadir+Federico (libro compartido) que duplique o pierda pagos, filtros por compañía. Verificá que un pago no se cuente dos veces ni desaparezca.`
  },
  {
    key: "integridad-datos",
    prompt: `DIMENSION: Integridad de datos y edge cases.
Buscá en index.html y migraciones: manejo de fechas (Date vs string, timezones, DD/MM/YYYY vs YYYY-MM-DD), rehidratacion desde localStorage/DB (campos Date que quedan string), keys de localStorage, orden de migraciones y idempotencia (if not exists), separadores de fecha en PDFs jsPDF (guion vs flecha/en-dash que rompen getTextWidth), normalizacion de nombres/DNI/telefono para dedup y matching, valores nullable no manejados, parseos que asumen formato. Casos borde que produzcan datos corruptos o crashes silenciosos.`
  },
  {
    key: "arquitectura-perf",
    prompt: `DIMENSION: Arquitectura, performance y mantenibilidad.
El front es UN index.html de ~683KB con React via Babel-standalone en el navegador (transpila en runtime). Anclas: build.mjs, npm run check, npm run smoke, componentes grandes, useEffect, re-renders.
Buscá: costo de Babel en runtime y tamaño del bundle, re-renders innecesarios / estado mal ubicado, falta de memo en listas grandes, ausencia de error boundaries, duplicacion de codigo (ej menu de tableros copiado en varios lugares), falta de tests mas alla del smoke, manejo de errores de red sin feedback al usuario, acoplamiento. Proponé mejoras concretas y realistas (sin reescribir todo) para robustez y velocidad de primer nivel.`
  },
]

phase('Revisar')

const results = await pipeline(
  DIMENSIONS,
  (d) => agent(`${COMMON}\n\n${d.prompt}\n\nDevolvé findings estructurados con evidencia (archivo:linea). Sé exhaustivo pero honesto con la severidad.`,
    { label: `review:${d.key}`, phase: 'Revisar', schema: FINDINGS_SCHEMA }),
  (review, d) => {
    if (!review) return null
    // Verificar adversarialmente solo los hallazgos concretos de peso (no las sugerencias/ux/perf).
    const aVerificar = review.findings.filter(f =>
      ["bug", "sincronizacion", "seguridad", "inconsistencia"].includes(f.tipo) &&
      ["critical", "high", "medium"].includes(f.severidad))
    if (!aVerificar.length) return { dimension: review.dimension, resumen: review.resumen, findings: review.findings }
    return parallel(aVerificar.map(f => () =>
      agent(`${COMMON}\n\nSos un revisor ESCEPTICO e INDEPENDIENTE. Otro auditor reportó este hallazgo en la dimension "${d.key}". Tu trabajo es intentar REFUTARLO leyendo el codigo real. Default a "refutado" si no encontrás evidencia clara.\n\nHALLAZGO:\nTitulo: ${f.titulo}\nTipo: ${f.tipo} | Severidad afirmada: ${f.severidad}\nEvidencia citada: ${f.evidencia}\nImpacto afirmado: ${f.impacto}\n\nVerificá en el codigo si es real, y ajustá la severidad si corresponde.`,
        { label: `verify:${d.key}:${f.id}`, phase: 'Verificar', schema: VERDICT_SCHEMA })
        .then(v => ({ ...f, _verdict: v }))
    )).then(verificados => {
      const byId = {}
      verificados.filter(Boolean).forEach(v => { byId[v.id] = v._verdict })
      const merged = review.findings.map(f => byId[f.id]
        ? { ...f, veredicto: byId[f.id].veredicto, severidad: byId[f.id].severidad_corregida, verificacion: byId[f.id].razonamiento }
        : { ...f, veredicto: "no-verificado" })
      return { dimension: review.dimension, resumen: review.resumen, findings: merged }
    })
  }
)

phase('Sintetizar')

const todo = results.filter(Boolean)
const allFindings = todo.flatMap(r => r.findings.map(f => ({ ...f, dimension: r.dimension })))
const confirmados = allFindings.filter(f => f.veredicto !== "refutado")
const refutados = allFindings.filter(f => f.veredicto === "refutado")

log(`Reviewers: ${todo.length}/8 · hallazgos: ${allFindings.length} · tras verificacion: ${confirmados.length} en pie, ${refutados.length} refutados`)

const SINTESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["veredicto_general", "top_criticos", "por_tema", "roadmap", "quick_wins"],
  properties: {
    veredicto_general: { type: "string", description: "diagnostico honesto del estado de Abordaje + flujo CRM, 1 parrafo" },
    top_criticos: {
      type: "array", description: "los problemas mas importantes ordenados por prioridad",
      items: {
        type: "object", additionalProperties: false,
        required: ["titulo", "severidad", "dimension", "porque_importa", "que_hacer", "esfuerzo"],
        properties: {
          titulo: { type: "string" }, severidad: { type: "string" }, dimension: { type: "string" },
          porque_importa: { type: "string" }, que_hacer: { type: "string" },
          esfuerzo: { type: "string", enum: ["bajo", "medio", "alto"] }
        }
      }
    },
    por_tema: {
      type: "array", description: "resumen agrupado por dimension/tema",
      items: {
        type: "object", additionalProperties: false,
        required: ["tema", "estado", "hallazgos_clave"],
        properties: { tema: { type: "string" }, estado: { type: "string", enum: ["solido", "aceptable", "con-riesgos", "critico"] }, hallazgos_clave: { type: "string" } }
      }
    },
    quick_wins: { type: "array", items: { type: "string" }, description: "arreglos de bajo esfuerzo y alto impacto" },
    roadmap: {
      type: "array", description: "pasos ordenados para llevar Abordaje a primer nivel",
      items: {
        type: "object", additionalProperties: false,
        required: ["fase", "objetivo", "acciones"],
        properties: { fase: { type: "string" }, objetivo: { type: "string" }, acciones: { type: "string" } }
      }
    }
  }
}

const payload = JSON.stringify(confirmados.map(f => ({
  dimension: f.dimension, titulo: f.titulo, tipo: f.tipo, severidad: f.severidad,
  impacto: f.impacto, recomendacion: f.recomendacion, evidencia: f.evidencia, veredicto: f.veredicto || "no-verificado"
})), null, 1)

const sintesis = await agent(
  `${COMMON}\n\nSos el auditor lider. Recibiste los hallazgos consolidados y verificados de 8 reviewers independientes sobre Proyecto Abordaje + su flujo con el CRM. Tu trabajo: producir un INFORME EJECUTIVO priorizado y accionable para llevar Abordaje a nivel de "producto de primer nivel".\n\nDedupí hallazgos repetidos entre dimensiones, priorizá por impacto real (seguridad/perdida de datos/sync roto primero), separá quick-wins de trabajo grande, y armá un roadmap por fases. Sé concreto y honesto. Los refutados NO los incluyas.\n\nHALLAZGOS CONFIRMADOS (JSON):\n${payload}`,
  { label: 'sintesis-final', phase: 'Sintetizar', schema: SINTESIS_SCHEMA }
)

return {
  meta: { reviewers: todo.length, hallazgos_totales: allFindings.length, confirmados: confirmados.length, refutados: refutados.length },
  por_dimension: todo.map(r => ({ dimension: r.dimension, resumen: r.resumen, n: r.findings.length })),
  informe: sintesis,
  detalle_confirmados: confirmados.map(f => ({ dimension: f.dimension, titulo: f.titulo, tipo: f.tipo, severidad: f.severidad, evidencia: f.evidencia, impacto: f.impacto, recomendacion: f.recomendacion, veredicto: f.veredicto || "no-verificado" }))
}
