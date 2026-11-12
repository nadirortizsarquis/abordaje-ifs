// crm-sync — Integración Abordaje -> CRM IFS Broker (bitácora de clientes).
//
// Puente server-to-server, UNA sola dirección (Abordaje -> CRM). Nunca borra ni
// pisa datos del CRM: solo busca clientes, crea (opt-in) y AGREGA entradas de
// bitácora. La idempotencia vive del lado Abordaje (crm_synced_at / crm_log_id
// por ítem); reapretar sin gestión nueva no reenvía nada.
//
// ANCLA POR CLIENTE (opción B, PM #819). El botón puede dispararse desde tres
// lugares: un prospecto (Lista de Abordaje), una tarea (kanban) o una agenda.
//   - Si el ítem tiene prospecto: el vínculo canónico vive en el PROSPECTO.
//   - Si es una tarea/agenda SUELTA: el vínculo vive en la propia fila
//     (abordaje_tareas.crm_client_id / abordaje_agendados.crm_client_id).
// El `sync` junta TODO lo que apunte al mismo crm_client_id (lo del prospecto +
// esa tarea + esa agenda) -> "trae la info de todos lados".
//
// Contrato del CRM (frozen, PM #858):
//   Header: Authorization: Token <CRM_API_TOKEN>   (usuario de servicio "abordaje")
//   Dedup:  GET  /clients/?document_number=<dni>        -> {count, results:[...]}
//   Crear:  POST /clients/  {first_name,last_name,document_number,advisor_email,...}
//   Log:    POST /clients/<id>/log/  {description, advisor_email, source:"abordaje"}
//   advisor_email es OBLIGATORIO y debe ser el email de un asesor activo del CRM;
//   si no, el CRM responde 400 {detail} y NO escribe nada.
//
// Body: { op, anchor_type:'prospecto'|'tarea'|'agendado', anchor_id, ... }.
//   (compat: si viene `prospecto_id`, se trata como anchor prospecto.)
// Ops:
//   lookup  -> candidatos por DNI (+ fuzzy por nombre)
//   create  {first_name,last_name,document_number,...} -> crea cliente y vincula el ancla
//   link    {crm_client_id}   -> vincula el ancla a un cliente existente
//   unlink                     -> suelta el vínculo del ancla (no toca el CRM)
//   status                     -> conteo de ítems del cliente pendientes de volcar
//   sync                       -> vuelca el delta del cliente a la bitácora del CRM
//
// Notas agregadas después de un sync (nov 2026): cada ítem guarda en
// crm_synced_blocks las notas (bloques "[dd/mm/aa hh:mm] ...") que ya llegaron
// al CRM. El próximo sync manda SOLO las notas nuevas o corregidas (delta.ts)
// como "actualización". Ítems con crm_synced_blocks NULL no se re-envían.
// Pendiente conocido: si se re-vincula a OTRO cliente, las notas nuevas de lo ya
// enviado van al cliente actual (sin el contexto que quedó en el anterior).
//
// Seguridad: JWT del caller. Asistentes fuera (403). El ancla tiene que ser del
// propio asesor (agente_id == caller) salvo admin. advisor_email = SIEMPRE el
// email del asesor DUEÑO del ítem (si un admin opera sobre un ítem ajeno, la
// bitácora queda atribuida al asesor real, no al admin).
// Propiedad del cliente CRM (nov 2026): un no-admin solo vincula / vuelca / ve
// candidatos de clientes de SU cartera (clienteEsDelAsesor), aunque el bot vea todo.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteEsDelAsesor, prospectoDelItem, puedeForzarCreate, soloSueltas } from "./ownership.ts";
import { type Nota, type NotesDelta, noteKeys, notesDelta, parseNote, parseNotes } from "./delta.ts";
import { buildDescription, buildPayload, type ItemEnvio } from "./format.ts";

// Keys nuevas (sb_secret_/sb_publishable_) llegan como JSON en SUPABASE_SECRET_KEYS /
// SUPABASE_PUBLISHABLE_KEYS; fallback a las legacy mientras sigan activas (PM #111).
function envKey(jsonVar: string, legacyVar: string): string {
  try {
    // 'default' si existe; si no, la primera (la secret actual se llama 'rotationjarvis').
    const m = JSON.parse(Deno.env.get(jsonVar) ?? "");
    const k = m?.default ?? Object.values(m ?? {})[0];
    if (typeof k === "string" && k) return k;
  } catch { /* sin keys nuevas */ }
  console.warn(`envKey: usando legacy ${legacyVar}`);
  return Deno.env.get(legacyVar)!;
}
const SERVICE_KEY = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

const TZ = "America/Argentina/Buenos_Aires";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ── Formateo de fechas (hora Argentina) ──────────────────────────────────────
function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
}
function fmtTime(t: string | null | undefined): string {
  if (!t) return "";
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : String(t);
}
function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("es-AR", {
      timeZone: TZ,
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(iso));
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
  } catch {
    return String(iso);
  }
}

const TIPO_LABELS: Record<string, string> = {
  agendado: "Agendado",
  contestador: "Contestador",
  mensaje_sin_respuesta: "Mensaje sin respuesta",
  fecha_exacta: "Fecha exacta",
  llamar_15min: "Llamar en 15 min",
  llamar_tarde: "Llamar más tarde",
  llamar_manana: "Llamar mañana",
  llamar_semana: "Llamar en una semana",
  llamar_lunes: "Llamar próximo lunes",
  llamar_dentro_de: "Llamar dentro de",
  rechazado: "Rechazado",
  recordatorio: "Recordatorio",
};
const COMPANIA_LABELS: Record<string, string> = {
  "ole": "Olé",
  "investors-trust": "Investors Trust",
  "life-group": "Life Group",
  "best-doctors": "Best Doctors",
  "patrimonial": "Patrimonial",
};

function quote(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  return t ? ` "${t}"` : "";
}

// Normaliza el documento para dedup/lookup/create: saca puntos, espacios y
// separadores comunes. "12.345.678" y "12345678" tienen que matchear el mismo
// cliente. Debe quedar alineado con el normDoc del front (index.html).
function normDoc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[.\s\-_]/g, "").trim();
}

// ── Cliente HTTP contra el CRM ───────────────────────────────────────────────
function crmClient() {
  const base = (Deno.env.get("CRM_API_URL") || "").replace(/\/+$/, "");
  const token = Deno.env.get("CRM_API_TOKEN") || "";
  if (!base || !token) {
    throw new HttpError(503, "CRM no configurado (faltan CRM_API_URL / CRM_API_TOKEN).");
  }
  return async function crm(path: string, init: RequestInit = {}) {
    // Timeout defensivo: si el CRM cuelga, no dejamos la función esperando hasta
    // el límite del runtime.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          "Authorization": `Token ${token}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (e) {
      throw new HttpError(504, (e as any)?.name === "AbortError"
        ? "El CRM no respondió a tiempo (timeout). Reintentá en un momento."
        : `No se pudo conectar al CRM: ${(e as any)?.message || e}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { detail: text }; }
    if (!res.ok) {
      throw new HttpError(res.status, body?.detail || JSON.stringify(body), body);
    }
    return body;
  };
}

// ── Resolución del ancla ─────────────────────────────────────────────────────
// Devuelve el prospecto (si hay), el cliente CRM efectivo, la fila donde se
// escribe/lee el vínculo (linkTarget) y datos de identidad para prefill/lookup.
interface Anchor {
  agenteId: string;
  prospecto: any | null;
  effectiveClientId: number | null;
  linkTarget: { table: string; id: string };
  identity: { nombre: string; documento: string };
}

async function resolveAnchor(
  supabase: any, type: string, id: string,
): Promise<Anchor> {
  if (type === "prospecto") {
    const { data: p } = await supabase.from("abordaje_prospectos")
      .select("id, nombre, telefono, documento, observaciones, detalle, referente, agente_id, crm_client_id")
      .eq("id", id).maybeSingle();
    if (!p) throw new HttpError(404, "prospecto no encontrado");
    return {
      agenteId: p.agente_id,
      prospecto: p,
      effectiveClientId: p.crm_client_id ?? null,
      linkTarget: { table: "abordaje_prospectos", id: p.id },
      identity: { nombre: p.nombre || "", documento: p.documento || "" },
    };
  }

  if (type === "tarea" || type === "agendado") {
    const table = type === "tarea" ? "abordaje_tareas" : "abordaje_agendados";
    const cols = type === "tarea"
      ? "id, titulo, prospecto_id, agente_id, crm_client_id"
      : "id, nota, prospecto_id, agente_id, crm_client_id";
    const { data: item } = await supabase.from(table).select(cols).eq("id", id).maybeSingle();
    if (!item) throw new HttpError(404, `${type} no encontrado`);

    let prospecto: any = null;
    if (item.prospecto_id) {
      const { data: p } = await supabase.from("abordaje_prospectos")
        .select("id, nombre, telefono, documento, observaciones, detalle, referente, agente_id, crm_client_id")
        .eq("id", item.prospecto_id).maybeSingle();
      // Defensa en profundidad: la base ya exige que el prospecto sea del mismo
      // agente que el ítem (trigger, migración 20261111113446). Si igual llegara
      // uno ajeno (ej. prospecto reasignado), el ítem se trata como suelto.
      prospecto = prospectoDelItem(item, p);
    }

    // Si el ítem tiene prospecto, el vínculo canónico vive en el prospecto.
    // Si es suelto, en la propia fila.
    const linkTarget = prospecto
      ? { table: "abordaje_prospectos", id: prospecto.id }
      : { table, id: item.id };
    const effectiveClientId = prospecto?.crm_client_id ?? item.crm_client_id ?? null;
    const identity = prospecto
      ? { nombre: prospecto.nombre || "", documento: prospecto.documento || "" }
      : { nombre: type === "tarea" ? (item.titulo || "") : "", documento: "" };

    return {
      agenteId: item.agente_id,
      prospecto,
      effectiveClientId,
      linkTarget,
      identity,
    };
  }

  throw new HttpError(400, `anchor_type inválido: ${type}`);
}

// ── Qué se manda al CRM (ver format.ts para la forma del texto) ──────────────
type SyncTable = "abordaje_prospecto_contactos" | "abordaje_agendados" | "abordaje_tareas";
interface StampItem { t: SyncTable; id: string; keys: string[]; c: number; col: string | null }

const TZ_PARTS = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return { fecha: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour")}:${g("minute")}`.replace(/^24/, "00") };
};
const hoyYear = () => Number(TZ_PARTS(new Date().toISOString()).fecha.slice(0, 4));
const dm = (iso: string | null | undefined) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

function notaContacto(c: any): Nota {
  const tipo = TIPO_LABELS[c.tipo] || (c.tipo || "Contacto");
  const obs = (c.observacion ?? "").trim();
  const fecha = c.fecha ? String(c.fecha).slice(0, 10) : (c.created_at ? TZ_PARTS(c.created_at).fecha : null);
  return { raw: "", fecha, hora: c.hora ? fmtTime(c.hora) : null, tipo: null, texto: obs ? `${tipo}: ${obs}` : tipo };
}
function notaAgenda(a: any): Nota {
  const p = a.fecha ? TZ_PARTS(a.fecha) : null;
  const nota = (a.nota ?? "").trim();
  return { raw: "", fecha: p?.fecha ?? null, hora: p?.hora ?? null, tipo: null, texto: nota || "(sin nota)" };
}
const porFechaDesc = (a: Nota, b: Nota) => `${b.fecha ?? ""}${b.hora ?? ""}`.localeCompare(`${a.fecha ?? ""}${a.hora ?? ""}`);

// Junta lo que hay que volcar de un cliente: lo nunca enviado (o enviado a OTRO
// cliente: re-vínculo -> se manda completo al nuevo) y las notas nuevas o
// corregidas de lo ya enviado. Una consulta por tabla, en paralelo; cualquier
// error corta ANTES de escribir en el CRM.
//  - Contactos: cuelgan de un prospecto vinculado a este cliente.
//  - Agendas y tareas: SOLO las sueltas vinculadas directo al cliente (las de un
//    prospecto vinculado son proyecciones de sus contactos -> no se duplican).
//  - Tareas archivadas: no se mandan como nuevas, pero sí sus notas posteriores.
//  - Un cambio de columna sin notas nuevas no dispara envío; viaja con la próxima.
async function gatherByClient(supabase: any, clientId: number, agenteId: string) {
  const { data: prosp, error: prospErr } = await supabase.from("abordaje_prospectos")
    .select("id, nombre").eq("crm_client_id", clientId).eq("agente_id", agenteId);
  if (prospErr) throw new HttpError(500, `No se pudieron leer los prospectos: ${prospErr.message}`);
  const prospIds: string[] = (prosp ?? []).map((r: any) => r.id);
  const nombreProsp = new Map<string, string>((prosp ?? []).map((r: any) => [r.id, r.nombre || ""]));

  const TRACK = "crm_synced_at, crm_synced_blocks, crm_synced_client_id";
  const none = Promise.resolve({ data: [], error: null });
  const [rc, ra, rt] = await Promise.all([
    prospIds.length
      ? supabase.from("abordaje_prospecto_contactos")
        .select(`id, prospecto_id, tipo, fecha, hora, observacion, created_at, ${TRACK}`)
        .in("prospecto_id", prospIds).eq("agente_id", agenteId)
      : none,
    supabase.from("abordaje_agendados")
      .select(`id, prospecto_id, fecha, nota, created_at, ${TRACK}`)
      .eq("agente_id", agenteId).eq("crm_client_id", clientId),
    supabase.from("abordaje_tareas")
      .select(`id, prospecto_id, titulo, observacion, columna_id, compania, fecha_recordatorio, hora_recordatorio, created_at, archivada, crm_synced_columna_id, ${TRACK}`)
      .eq("agente_id", agenteId).eq("crm_client_id", clientId),
  ]);
  for (const r of [rc, ra, rt]) {
    if (r.error) throw new HttpError(500, `No se pudo leer la gestión del cliente: ${r.error.message}`);
  }
  const contactosAll: any[] = rc.data ?? [];
  const agendadosAll: any[] = soloSueltas(ra.data ?? [], prospIds);
  const tareasAll: any[] = soloSueltas(rt.data ?? [], prospIds);

  const colIds = [...new Set(tareasAll.flatMap((t) => [t.columna_id, t.crm_synced_columna_id]).filter(Boolean))];
  const colName = new Map<string, string>();
  if (colIds.length) {
    const { data: cols, error } = await supabase.from("abordaje_tareas_columnas").select("id, titulo").in("id", colIds);
    if (error) throw new HttpError(500, `No se pudieron leer las columnas: ${error.message}`);
    for (const col of cols ?? []) colName.set(col.id, col.titulo);
  }

  // Pendiente = nunca enviado, o enviado a otro cliente (re-vínculo).
  const pendiente = (r: any) => !r.crm_synced_at || (r.crm_synced_client_id != null && Number(r.crm_synced_client_id) !== clientId);
  const yaEnEste = (r: any) => !!r.crm_synced_at && !!r.crm_synced_blocks && !pendiente(r);

  const items: ItemEnvio[] = [];
  const stamps: StampItem[] = [];
  const cnt = { contactos: 0, agendados: 0, tareas: 0, actualizaciones: 0 };
  const stamp = (t: SyncTable, id: string, text: string | null, col: string | null = null) =>
    stamps.push({ t, id, keys: noteKeys(text), c: clientId, col });

  // Contactos nuevos: un bloque por prospecto.
  const porProsp = new Map<string, any[]>();
  for (const c of contactosAll.filter(pendiente)) {
    (porProsp.get(c.prospecto_id) ?? porProsp.set(c.prospecto_id, []).get(c.prospecto_id)!).push(c);
  }
  for (const [pid, cs] of porProsp) {
    items.push({ kind: "contactos", actualizacion: false, titulo: nombreProsp.get(pid) || "", notas: cs.map(notaContacto).sort(porFechaDesc) });
    for (const c of cs) stamp("abordaje_prospecto_contactos", c.id, c.observacion);
    cnt.contactos += cs.length;
  }
  // Agendas nuevas: un bloque.
  const agNuevas = agendadosAll.filter(pendiente);
  if (agNuevas.length) {
    items.push({ kind: "agenda", actualizacion: false, titulo: "", notas: agNuevas.map(notaAgenda).sort(porFechaDesc) });
    for (const a of agNuevas) stamp("abordaje_agendados", a.id, a.nota);
    cnt.agendados += agNuevas.length;
  }
  // Tareas nuevas: un bloque cada una.
  const metaTarea = (t: any) => ({
    columna: colName.get(t.columna_id) || "",
    compania: COMPANIA_LABELS[t.compania] || t.compania || "",
    recordatorio: t.fecha_recordatorio ? [dm(String(t.fecha_recordatorio)), t.hora_recordatorio ? fmtTime(t.hora_recordatorio) : ""].filter(Boolean).join(" ") : "",
  });
  for (const t of tareasAll.filter((t) => pendiente(t) && !t.archivada)) {
    items.push({ kind: "tarea", actualizacion: false, titulo: t.titulo || "", ...metaTarea(t), notas: parseNotes(t.observacion) });
    stamp("abordaje_tareas", t.id, t.observacion, t.columna_id ?? null);
    cnt.tareas++;
  }

  // Actualizaciones de lo ya enviado a ESTE cliente.
  const upd = (r: any, text: string | null, mk: (d: NotesDelta) => ItemEnvio, t: SyncTable, col: string | null = null) => {
    if (!yaEnEste(r)) return;
    const d = notesDelta(r.crm_synced_blocks, text);
    if (!d) return;
    items.push(mk(d));
    stamp(t, r.id, text, col);
    cnt.actualizaciones++;
  };
  const notas = (d: NotesDelta) => ({ notas: d.nuevas.map(parseNote), corregidas: d.editadas.map(parseNote) });
  for (const c of contactosAll) {
    const n = notaContacto({ ...c, observacion: "" });
    upd(c, c.observacion, (d) => ({ kind: "contacto", actualizacion: true,
      titulo: `${dm(n.fecha)} ${n.texto} · ${nombreProsp.get(c.prospecto_id) || ""}`.trim(), ...notas(d) }), "abordaje_prospecto_contactos");
  }
  for (const a of agendadosAll) {
    const n = notaAgenda(a);
    upd(a, a.nota, (d) => ({ kind: "agenda", actualizacion: true, titulo: `${dm(n.fecha)} ${n.hora ?? ""}`.trim(), ...notas(d) }), "abordaje_agendados");
  }
  for (const t of tareasAll) {
    const m = metaTarea(t);
    const anterior = t.crm_synced_columna_id && t.crm_synced_columna_id !== t.columna_id ? colName.get(t.crm_synced_columna_id) || "" : "";
    upd(t, t.observacion, (d) => ({ kind: "tarea", actualizacion: true, titulo: t.titulo || "",
      columna: m.columna, columnaAnterior: anterior || undefined, compania: m.compania, ...notas(d) }),
      "abordaje_tareas", t.columna_id ?? null);
  }

  return { items, stamps, cnt, prospIds };
}

// Identificador estable del envío: mismo cliente + mismas notas = mismo id. El CRM
// lo usa como llave (source + source_id): si un reintento manda lo mismo, devuelve
// la entrada existente en vez de duplicarla.
async function sourceIdDe(clientId: number, stamps: StampItem[]): Promise<string> {
  const canon = JSON.stringify({ c: clientId, s: stamps.map((s) => [s.t, s.id, [...s.keys].sort()]).sort((a, b) => String(a[1]).localeCompare(String(b[1]))) });
  const dig = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon)));
  return "u1:" + [...dig].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

// Vuelca a la bitácora del CRM todo lo pendiente de un cliente y lo marca.
async function syncCliente(
  supabase: any, crm: (p: string, i?: RequestInit) => Promise<any>,
  o: { clientId: number; agenteId: string; actingEmail: string; isAdmin: boolean },
): Promise<{ status: number; body: Record<string, any> }> {
  // Barrera real: crm_client_id puede venir del typeahead o setearse directo en la
  // fila (RLS deja editar la propia), sin pasar por `link`. Re-verificar SIEMPRE.
  // (Se chequea después de juntar: sin nada pendiente no hace falta consultar el CRM.)
  const { items, stamps, cnt, prospIds } = await gatherByClient(supabase, o.clientId, o.agenteId);
  const extra = { multi_prospecto: (prospIds?.length || 0) > 1, prospecto_count: prospIds?.length || 0 };
  if (!stamps.length) {
    return { status: 200, body: { ok: true, action: "noop", synced: 0, message: "No hay gestión nueva para volcar.", ...extra } };
  }
  if (!o.isAdmin && !(await clienteEsDelAsesor(crm, o.clientId, o.actingEmail))) {
    return { status: 403, body: { error: "client_not_owned", message: "El cliente vinculado no está en tu cartera del CRM. No se volcó nada; desvinculalo o pedile a un administrador." } };
  }
  const log = await crm(`/clients/${o.clientId}/log/`, {
    method: "POST",
    body: JSON.stringify({
      description: buildDescription(items, hoyYear()),
      payload: buildPayload(items),
      advisor_email: o.actingEmail,
      source: "abordaje",
      source_id: await sourceIdDe(o.clientId, stamps),
    }),
  });
  const logId = log?.id ?? null;
  // Marcado atómico (RPC crm_sync_stamp): suma las notas enviadas a
  // crm_synced_blocks y guarda cliente y columna del envío. Si falla, el
  // reintento es seguro: el CRM reconoce el mismo source_id y no duplica.
  const { data: stamped, error: stampErr } = await supabase.rpc("crm_sync_stamp", {
    p_log_id: logId, p_now: new Date().toISOString(), p_items: stamps,
  });
  if (stampErr) console.error("crm-sync stamp falló:", stampErr.message);
  const synced = cnt.contactos + cnt.agendados + cnt.tareas + cnt.actualizaciones;
  if (stampErr || stamped !== stamps.length) {
    return { status: 200, body: { ok: true, action: "synced_unmarked", retry_safe: true, crm_log_id: logId, synced, detalle: cnt,
      warning: "Se volcó al CRM pero no se pudo marcar todo. Podés reintentar: no se duplica.", ...extra } };
  }
  return { status: 200, body: { ok: true, action: "synced", crm_log_id: logId, synced, detalle: cnt, ...extra } };
}

// Clientes del CRM con gestión vinculada de un asesor (para el sync nocturno).
async function clientesDe(supabase: any, agenteId: string): Promise<number[]> {
  const ids = new Set<number>();
  for (const t of ["abordaje_prospectos", "abordaje_tareas", "abordaje_agendados"]) {
    const { data, error } = await supabase.from(t).select("crm_client_id").eq("agente_id", agenteId).not("crm_client_id", "is", null);
    if (error) throw new HttpError(500, `No se pudieron leer los vínculos: ${error.message}`);
    for (const r of data ?? []) ids.add(Number(r.crm_client_id));
  }
  return [...ids];
}

// ── Auth interna (MCP) ───────────────────────────────────────────────────────
// Secret keys del proyecto (sb_secret_*) + la legacy service_role mientras siga
// activa. Mismo criterio que gcal-events-admin.
function serviceKeys(): string[] {
  const out: string[] = [];
  try {
    const m = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "");
    for (const v of Object.values(m ?? {})) if (typeof v === "string" && v) out.push(v);
  } catch { /* sin keys nuevas */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) out.push(legacy);
  return out;
}
function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// advisors.crm_sync_enabled del usuario (por profiles.advisor_id o, en fallback, por email).
async function crmHabilitado(supabase: any, userId: string): Promise<boolean> {
  const { data: prof } = await supabase.from("profiles").select("advisor_id, email").eq("id", userId).maybeSingle();
  if (prof?.advisor_id) {
    const { data: adv } = await supabase.from("advisors").select("crm_sync_enabled").eq("id", prof.advisor_id).maybeSingle();
    return !!adv?.crm_sync_enabled;
  }
  if (prof?.email) {
    const { data: adv } = await supabase.from("advisors")
      // Igualdad sin distinguir mayúsculas: se escapan % y _ para que no actúen de comodín (sec-16).
      .select("crm_sync_enabled").ilike("email", prof.email.replace(/[\\%_]/g, (c: string) => "\\" + c)).maybeSingle();
    return !!adv?.crm_sync_enabled;
  }
  return false;
}

// ── sync_all ── sync nocturno (lo dispara el MCP): todos los clientes vinculados
// de cada asesor habilitado. Mismos chequeos que el botón. Corta a los ~110 s
// (lo que queda sale la noche siguiente o con el botón).
async function syncAll(supabase: any) {
  const t0 = Date.now();
  const crm = crmClient();
  const { data: profs, error } = await supabase.from("profiles").select("id, email, role, assistant_of_id");
  if (error) throw new HttpError(500, `No se pudieron leer los usuarios: ${error.message}`);
  const results: any[] = [];
  let truncated = false;
  for (const p of profs ?? []) {
    if (p.assistant_of_id || !p.email) continue;
    const isAdmin = p.role === "admin";
    if (!isAdmin && !(await crmHabilitado(supabase, p.id))) continue;
    for (const clientId of await clientesDe(supabase, p.id)) {
      if (Date.now() - t0 > 110_000) { truncated = true; break; }
      try {
        const r = await syncCliente(supabase, crm, { clientId, agenteId: p.id, actingEmail: p.email.trim(), isAdmin });
        if (r.body.action !== "noop") results.push({ user_id: p.id, client_id: clientId, status: r.status, action: r.body.action ?? r.body.error, synced: r.body.synced ?? 0 });
      } catch (e) {
        results.push({ user_id: p.id, client_id: clientId, error: String((e as any)?.message || e) });
      }
    }
    if (truncated) break;
  }
  return jsonResponse({ ok: true, results, truncated });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SERVICE_KEY,
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const op: string = body?.op || "";
    if (!op) return jsonResponse({ error: "missing op" }, 400);

    // 1) Auth del caller. Dos caminos:
    //  - Usuario: JWT de Supabase Auth (front de Universo / Abordaje).
    //  - Interno: Authorization = secret key del proyecto (MCP en Railway: tool
    //    sincronizar_crm y sync nocturno). Solo status/sync (con body.user_id, que
    //    actúa como ese usuario con TODOS sus chequeos) y sync_all.
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const internal = !!jwt && serviceKeys().some((k) => timingSafeEqualStr(jwt, k));
    const INTERNAL_OPS = new Set(["status", "sync", "sync_all"]);
    if (internal && !INTERNAL_OPS.has(op)) return jsonResponse({ error: `op no permitida por la vía interna: ${op}` }, 403);
    if (!internal && op === "sync_all") return jsonResponse({ error: "solo vía interna" }, 403);

    if (op === "sync_all") return await syncAll(supabase);

    let user: { id: string; email: string | null };
    if (internal) {
      const uid = String(body?.user_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(uid)) return jsonResponse({ error: "missing user_id" }, 400);
      const { data: p } = await supabase.from("profiles").select("id, email").eq("id", uid).maybeSingle();
      if (!p) return jsonResponse({ error: "usuario inexistente" }, 404);
      user = { id: p.id, email: p.email ?? null };
    } else {
      const { data: { user: u }, error: userErr } = await supabase.auth.getUser(jwt);
      if (userErr || !u) return jsonResponse({ error: "unauthorized" }, 401);
      user = { id: u.id, email: u.email ?? null };
    }

    const { data: profile } = await supabase.from("profiles")
      .select("id, email, role, assistant_of_id")
      .eq("id", user.id).maybeSingle();

    // 2) Asistentes fuera.
    if (profile?.assistant_of_id) {
      return jsonResponse({ error: "Los asistentes no pueden vincular clientes al CRM." }, 403);
    }
    const isAdmin = profile?.role === "admin";
    // Email del JWT primero (verificado por Auth); el de profiles solo como respaldo (sec-01/sec-16).
    const advisorEmail = (user.email || profile?.email || "").trim();

    // Habilitación server-side (NO confiar solo en el gating del front).
    const crmEnabled = isAdmin || await crmHabilitado(supabase, user.id);

    // Ops que leen/escriben contra el CRM: exigen habilitación server-side.
    // Nota: crm_client_id también se puede escribir directo en la fila (typeahead
    // al crear, RLS de la fila propia). Eso NO es la barrera: la barrera real es
    // `sync`, que exige habilitación + clienteEsDelAsesor antes de volcar nada.
    // unlink/status no hablan con el CRM pero tocan/leen el vínculo: mismo gate,
    // así un asesor deshabilitado no puede operar el vínculo por la función.
    const CRM_OPS = new Set(["search", "lookup", "create", "link", "unlink", "status", "sync"]);
    if (CRM_OPS.has(op) && !crmEnabled) {
      return jsonResponse({ error: "Sincronización con CRM deshabilitada para tu usuario." }, 403);
    }

    // ── search ── typeahead de clientes del CRM (sin ancla; para vincular al
    // crear un prospecto/tarea). Scoping por asesor (endpoint de Bruno): a los
    // no-admins les pasamos su advisor_email y el CRM devuelve SOLO sus clientes
    // (email inexistente -> vacío, nunca clientes ajenos). Los admins usan el bot
    // (ve todos), sin advisor_email.
    if (op === "search") {
      const q = String(body?.q ?? "").trim();
      if (!q) return jsonResponse({ ok: true, clients: [], scoped: true });
      const crm = crmClient();
      // Fail-closed: un no-admin sin email NO puede buscar sin scope (el bot ve todo).
      if (!isAdmin && !advisorEmail) return jsonResponse({ ok: true, clients: [], scoped: true });
      const scopeParam = !isAdmin ? `&advisor_email=${encodeURIComponent(advisorEmail)}` : "";
      const r = await crm(`/clients/?search=${encodeURIComponent(q)}${scopeParam}`);
      const clients = (r?.results ?? []).slice(0, 15);
      return jsonResponse({ ok: true, clients, scoped: true });
    }

    // ── verify_advisor ── (solo admin) verifica si un email es asesor del CRM.
    // Para el indicador verde/rojo del Directorio (Ajustes → Directorio).
    if (op === "verify_advisor") {
      if (!isAdmin) return jsonResponse({ error: "solo admin" }, 403);
      const email = String(body?.email ?? "").trim();
      if (!email) return jsonResponse({ ok: true, exists: false, active: false, full_name: "" });
      const crm = crmClient();
      const r = await crm(`/auth/verify-advisor/?email=${encodeURIComponent(email)}`);
      return jsonResponse({ ok: true, exists: !!r?.exists, active: !!r?.active, full_name: r?.full_name || "" });
    }

    // Ancla: prospecto/tarea/agendado (compat: prospecto_id -> prospecto).
    let anchorType: string = body?.anchor_type || "";
    let anchorId: string = body?.anchor_id || "";
    if (!anchorType && body?.prospecto_id) {
      anchorType = "prospecto";
      anchorId = body.prospecto_id;
    }
    if (!anchorType || !anchorId) {
      return jsonResponse({ error: "missing anchor (anchor_type + anchor_id)" }, 400);
    }

    const anchor = await resolveAnchor(supabase, anchorType, anchorId);

    // 3) Propiedad.
    if (!isAdmin && anchor.agenteId !== user.id) {
      return jsonResponse({ error: "forbidden: ítem de otro asesor" }, 403);
    }

    // Atribución: la gestión se firma SIEMPRE con el email del asesor DUEÑO del
    // ítem, no el del caller. Para el 99% (caller == dueño) es lo mismo; cuando
    // un admin opera sobre un ítem ajeno, la bitácora queda atribuida al asesor
    // real (no al admin). Cae al email del caller solo si el dueño no tiene uno.
    let actingEmail = advisorEmail;
    if (anchor.agenteId && anchor.agenteId !== user.id) {
      const { data: owner } = await supabase.from("profiles")
        .select("email").eq("id", anchor.agenteId).maybeSingle();
      if (owner?.email && owner.email.trim()) actingEmail = owner.email.trim();
    }

    const nowIso = () => new Date().toISOString();
    const setLink = async (clientId: number | null) => {
      await supabase.from(anchor.linkTarget.table).update({
        crm_client_id: clientId,
        crm_linked_at: clientId ? nowIso() : null,
        crm_linked_by: clientId ? user.id : null,
      }).eq("id", anchor.linkTarget.id);
    };

    // ── lookup ── candidatos en el CRM (no escribe) ──────────────────────────
    if (op === "lookup") {
      // Scoping: igual que search, los no-admins no leen el CRM hasta que Bruno
      // exponga la búsqueda scopeada por asesor (evita enumerar clientes ajenos).
      if (!isAdmin) {
        return jsonResponse({ ok: true, exact: [], fuzzy: [], documento: "", pendingScope: true });
      }
      const crm = crmClient();
      const doc = normDoc(body.documento ?? anchor.identity.documento ?? "");
      let exact: any[] = [];
      if (doc) {
        const r = await crm(`/clients/?document_number=${encodeURIComponent(doc)}`);
        exact = r?.results ?? [];
      }
      let fuzzy: any[] = [];
      const term = (body.search ?? anchor.identity.nombre ?? "").trim();
      if (term) {
        const r = await crm(`/clients/?search=${encodeURIComponent(term)}`);
        const exactIds = new Set(exact.map((c) => c.id));
        fuzzy = (r?.results ?? []).filter((c: any) => !exactIds.has(c.id)).slice(0, 10);
      }
      return jsonResponse({ ok: true, exact, fuzzy, documento: doc });
    }

    // ── link ── vincula el ancla a un cliente existente ──────────────────────
    if (op === "link") {
      const crmClientId = Number(body.crm_client_id);
      if (!crmClientId || Number.isNaN(crmClientId)) {
        return jsonResponse({ error: "missing crm_client_id" }, 400);
      }
      // Validar que el cliente EXISTA en el CRM antes de fijar el vínculo (evita
      // anclas a ids inexistentes que después volcarían al cliente equivocado).
      // FAIL-CLOSED: solo fijamos el vínculo si el CRM confirmó el cliente (2xx).
      // Un 404 -> no existe; cualquier otro fallo (5xx/timeout) -> NO vinculamos y
      // pedimos reintentar, para no anclar a ciegas sobre un CRM que no respondió.
      // No-admin: clienteEsDelAsesor ya lee el detalle (404 -> false), así que no
      // se pide dos veces; y "no existe" y "es ajeno" dan la misma respuesta, para
      // no revelar qué ids existen en carteras de otros.
      if (isAdmin) {
        try {
          await crmClient()(`/clients/${crmClientId}/`);
        } catch (e) {
          if ((e as any)?.status === 404) {
            return jsonResponse({ error: `El cliente #${crmClientId} no existe en el CRM.` }, 404);
          }
          return jsonResponse({
            error: "No se pudo validar el cliente en el CRM (no respondió). No se fijó el vínculo; reintentá en un momento.",
            crm_status: (e as any)?.status || 504,
          }, 502);
        }
      } else {
        let propio = false;
        try { propio = await clienteEsDelAsesor(crmClient(), crmClientId, actingEmail); } catch (e) {
          return jsonResponse({
            error: "No se pudo validar el cliente en el CRM (no respondió). No se fijó el vínculo; reintentá en un momento.",
            crm_status: (e as any)?.status || 504,
          }, 502);
        }
        if (!propio) {
          return jsonResponse({ error: "client_not_owned", message: "Ese cliente del CRM no está en tu cartera. Pedile a un administrador que lo vincule." }, 403);
        }
      }
      await setLink(crmClientId);
      return jsonResponse({
        ok: true, action: "linked", crm_client_id: crmClientId,
        link_target: anchor.linkTarget,
      });
    }

    // ── unlink ── suelta el vínculo del ancla (no toca el CRM) ───────────────
    if (op === "unlink") {
      await setLink(null);
      return jsonResponse({ ok: true, action: "unlinked", link_target: anchor.linkTarget });
    }

    // ── create ── crea el cliente en el CRM (opt-in) y vincula el ancla ──────
    if (op === "create") {
      const crm = crmClient();
      const first = (body.first_name ?? "").trim();
      const last = (body.last_name ?? "").trim();
      const doc = normDoc(body.document_number ?? anchor.identity.documento ?? "");
      if (!first || !last || !doc) {
        return jsonResponse({ error: "first_name, last_name y document_number son obligatorios" }, 400);
      }
      // Idempotencia: antes de crear, chequeamos que no exista ya un cliente con
      // ese documento. Si existe, NO creamos un duplicado: devolvemos 409 con los
      // candidatos para que el front ofrezca vincular. `force:true` lo saltea (caso
      // raro de documentos legítimamente repetidos). SOLO admin: un asesor que lo
      // mandara a mano saltearía la regla "ese DNI es de otro asesor, pedile a un admin".
      if (body.force && !isAdmin) {
        return jsonResponse({ error: "force_solo_admin", message: "Solo un administrador puede forzar el alta con un documento repetido." }, 403);
      }
      if (!puedeForzarCreate(body.force, isAdmin)) {
        try {
          const dup = await crm(`/clients/?document_number=${encodeURIComponent(doc)}`);
          const cands = dup?.results ?? [];
          // No-admin: el chequeo es global (no duplicar en el CRM), pero NO se
          // exponen clientes de otros asesores (nombre/email/teléfono): solo los propios.
          if (cands.length && !isAdmin) {
            const own = await crm(`/clients/?document_number=${encodeURIComponent(doc)}&advisor_email=${encodeURIComponent(actingEmail)}`);
            const propios = own?.results ?? [];
            // El 409 es inevitable (no se puede crear un duplicado), así que revela
            // que el DNI existe en el CRM. Mitigación: solo asesores habilitados
            // llegan acá y cada choque contra un DNI ajeno queda en los logs para
            // detectar enumeración.
            if (!propios.length) {
              console.warn(JSON.stringify({ evt: "crm_create_dni_ajeno", user_id: user.id, doc_tail: doc.slice(-3) }));
            }
            return jsonResponse(propios.length ? {
              error: "duplicate_document",
              message: `Ya tenés un cliente con el documento ${doc} en el CRM. Vinculá en vez de crear uno nuevo.`,
              candidates: propios.slice(0, 10),
            } : {
              error: "duplicate_document",
              message: `Ya existe un cliente con el documento ${doc} en el CRM. Pedile a un administrador que lo revise.`,
              candidates: [],
            }, 409);
          }
          if (cands.length) {
            return jsonResponse({
              error: "duplicate_document",
              message: `Ya existe un cliente con el documento ${doc} en el CRM. Vinculá en vez de crear uno nuevo.`,
              candidates: cands.slice(0, 10),
            }, 409);
          }
        } catch (e) {
          // Si el chequeo de dedup falla (CRM no respondió), no creamos a ciegas:
          // mejor pedir reintento que arriesgar un duplicado.
          return jsonResponse({
            error: "No se pudo verificar duplicados en el CRM (no respondió). No se creó el cliente; reintentá en un momento.",
            crm_status: (e as any)?.status || 504,
          }, 502);
        }
      }
      const payload: Record<string, unknown> = {
        first_name: first, last_name: last, document_number: doc,
        advisor_email: actingEmail,
        origin_detail: (body.origin_detail && String(body.origin_detail).trim()) || "Abordaje",
      };
      const p = anchor.prospecto;
      const phone = (body.phone ?? p?.telefono ?? "").trim();
      const email = (body.email ?? "").trim();
      const notes = (body.notes ?? p?.observaciones ?? p?.detalle ?? "").trim();
      const referred = (body.referred_by_text ?? p?.referente ?? "").trim();
      if (phone) payload.phone = phone;
      if (email) payload.email = email;
      if (notes) payload.notes = notes;
      if (referred) payload.referred_by_text = referred;
      if (typeof body.is_smoker === "boolean") payload.is_smoker = body.is_smoker;
      for (
        const k of [
          "province", "country", "date_of_birth", "sex", "address", "occupation",
          "hobby", "family_links", "social_media",
          "origin_type_id", "document_type_id", "status_id",
        ]
      ) {
        if (body[k] !== undefined && body[k] !== null && body[k] !== "") payload[k] = body[k];
      }

      const client = await crm(`/clients/`, { method: "POST", body: JSON.stringify(payload) });
      await setLink(client.id);
      return jsonResponse({ ok: true, action: "created", client, link_target: anchor.linkTarget });
    }

    // ── status ── conteo de ítems del cliente pendientes de volcar ───────────
    if (op === "status") {
      if (!anchor.effectiveClientId) {
        return jsonResponse({ ok: true, crm_client_id: null, pendientes: 0, detalle: { contactos: 0, agendados: 0, tareas: 0, actualizaciones: 0 } });
      }
      const { cnt, prospIds } = await gatherByClient(supabase, anchor.effectiveClientId, anchor.agenteId);
      return jsonResponse({
        ok: true,
        crm_client_id: anchor.effectiveClientId,
        pendientes: cnt.contactos + cnt.agendados + cnt.tareas + cnt.actualizaciones,
        detalle: cnt,
        // Aviso: si varios prospectos apuntan al mismo cliente CRM, al sincronizar
        // se vuelca la gestión de TODOS. El front lo muestra para que no sorprenda.
        multi_prospecto: (prospIds?.length || 0) > 1,
        prospecto_count: prospIds?.length || 0,
      });
    }

    // ── sync ── vuelca el delta del cliente a la bitácora del CRM ────────────
    if (op === "sync") {
      if (!anchor.effectiveClientId) {
        return jsonResponse({ error: "El ítem no está vinculado a un cliente del CRM." }, 400);
      }
      const r = await syncCliente(supabase, crmClient(), {
        clientId: anchor.effectiveClientId, agenteId: anchor.agenteId, actingEmail, isAdmin,
      });
      return jsonResponse(r.body, r.status);
    }

    return jsonResponse({ error: `unknown op: ${op}` }, 400);
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message, crm_status: err.status, crm_body: err.body },
        err.status >= 400 && err.status < 600 ? err.status : 502);
    }
    console.error("crm-sync error:", err);
    return jsonResponse({ error: String((err as any)?.message || err) }, 500);
  }
});
