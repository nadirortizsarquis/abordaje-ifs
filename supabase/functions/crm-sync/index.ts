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
// Seguridad: JWT del caller. Asistentes fuera (403). El ancla tiene que ser del
// propio asesor (agente_id == caller) salvo admin. advisor_email = SIEMPRE el
// email del asesor DUEÑO del ítem (si un admin opera sobre un ítem ajeno, la
// bitácora queda atribuida al asesor real, no al admin).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ── Armado del texto de bitácora (agrupado por origen, cronológico) ──────────
function buildBitacora(
  contactos: any[], agendados: any[], tareas: any[], colName: Map<string, string>,
): string {
  const blocks: string[] = [];

  if (contactos.length) {
    const lines = contactos
      .slice()
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))
      .map((c) => {
        const fecha = fmtDate(c.fecha) || fmtDate(c.created_at);
        const hora = fmtTime(c.hora);
        const cuando = [fecha, hora].filter(Boolean).join(" ");
        const tipo = TIPO_LABELS[c.tipo] || (c.tipo || "Contacto");
        const obs = quote(c.observacion);
        return `- ${cuando} — ${tipo}.${obs}`;
      });
    blocks.push("[Abordaje · Contactos]\n" + lines.join("\n"));
  }

  if (agendados.length) {
    const lines = agendados
      .slice()
      .sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""))
      .map((a) => `- ${fmtTs(a.fecha)} —${quote(a.nota) || " (sin nota)"}`);
    blocks.push("[Abordaje · Agenda]\n" + lines.join("\n"));
  }

  if (tareas.length) {
    const lines = tareas
      .slice()
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))
      .map((t) => {
        const col = colName.get(t.columna_id) || "";
        const cia = COMPANIA_LABELS[t.compania] || t.compania || "";
        const meta = [
          col ? `columna: ${col}` : "",
          cia ? `compañía: ${cia}` : "",
        ].filter(Boolean).join(" · ");
        const head = `- Tarea${quote(t.titulo) || " (sin título)"}${meta ? ` (${meta})` : ""}`;
        const sub: string[] = [];
        const creada = fmtDate(t.created_at);
        const rec = t.fecha_recordatorio
          ? `recordatorio ${fmtDate(t.fecha_recordatorio)}${t.hora_recordatorio ? " " + fmtTime(t.hora_recordatorio) : ""}`
          : "";
        const linea2 = [creada ? `creada ${creada}` : "", rec].filter(Boolean).join(" · ");
        if (linea2) sub.push(`    ${linea2}`);
        if ((t.observacion || "").trim()) sub.push(`    Nota:${quote(t.observacion)}`);
        return [head, ...sub].join("\n");
      });
    blocks.push("[Abordaje · Tareas]\n" + lines.join("\n"));
  }

  return blocks.join("\n\n");
}

// ── Resolución del ancla ─────────────────────────────────────────────────────
// Devuelve el prospecto (si hay), el cliente CRM efectivo, la fila donde se
// escribe/lee el vínculo (linkTarget) y datos de identidad para prefill/lookup.
interface Anchor {
  agenteId: string;
  prospectoId: string | null;
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
      prospectoId: p.id,
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
      prospecto = p || null;
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
      prospectoId: item.prospecto_id || null,
      prospecto,
      effectiveClientId,
      linkTarget,
      identity,
    };
  }

  throw new HttpError(400, `anchor_type inválido: ${type}`);
}

// ── Junta todos los ítems de gestión (pendientes) que apuntan a un cliente ───
async function gatherByClient(supabase: any, clientId: number, agenteId: string) {
  const { data: prosp } = await supabase.from("abordaje_prospectos")
    .select("id").eq("crm_client_id", clientId).eq("agente_id", agenteId);
  const prospIds: string[] = (prosp ?? []).map((r: any) => r.id);

  // Contactos: solo cuelgan de un prospecto.
  let contactos: any[] = [];
  if (prospIds.length) {
    const { data } = await supabase.from("abordaje_prospecto_contactos")
      .select("id, tipo, fecha, hora, observacion, created_at")
      .in("prospecto_id", prospIds).is("crm_synced_at", null);
    contactos = data ?? [];
  }

  // Agendas y tareas: SOLO las SUELTAS vinculadas directo a un cliente
  // (crm_client_id). Las que cuelgan de un prospecto son proyecciones del
  // contacto (que es el registro canónico) -> NO se vuelcan, para no duplicar
  // la misma gestión en la bitácora del CRM (recordatorios incluidos).
  const { data: ag } = await supabase.from("abordaje_agendados")
    .select("id, fecha, nota, created_at")
    .eq("agente_id", agenteId).is("crm_synced_at", null)
    .eq("crm_client_id", clientId);

  const { data: tr } = await supabase.from("abordaje_tareas")
    .select("id, titulo, observacion, columna_id, compania, fecha_recordatorio, hora_recordatorio, created_at")
    .eq("agente_id", agenteId).eq("archivada", false).is("crm_synced_at", null)
    .eq("crm_client_id", clientId);

  return { contactos, agendados: ag ?? [], tareas: tr ?? [] };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // 1) Auth del caller.
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !user) return jsonResponse({ error: "unauthorized" }, 401);

    const { data: profile } = await supabase.from("profiles")
      .select("id, email, role, assistant_of_id")
      .eq("id", user.id).maybeSingle();

    // 2) Asistentes fuera.
    if (profile?.assistant_of_id) {
      return jsonResponse({ error: "Los asistentes no pueden vincular clientes al CRM." }, 403);
    }
    const isAdmin = profile?.role === "admin";
    const advisorEmail = (profile?.email || user.email || "").trim();

    // Habilitación server-side (NO confiar solo en el gating del front): admins
    // siempre; el resto según advisors.crm_sync_enabled (por profiles.advisor_id
    // o, en fallback, por email). Las ops que tocan el CRM se bloquean si está
    // deshabilitado — así el gating de UI no se puede saltear llamando la función.
    let crmEnabled = isAdmin;
    if (!crmEnabled) {
      const { data: prof } = await supabase.from("profiles")
        .select("advisor_id, email").eq("id", user.id).maybeSingle();
      if (prof?.advisor_id) {
        const { data: adv } = await supabase.from("advisors")
          .select("crm_sync_enabled").eq("id", prof.advisor_id).maybeSingle();
        crmEnabled = !!adv?.crm_sync_enabled;
      } else if (prof?.email) {
        const { data: adv } = await supabase.from("advisors")
          .select("crm_sync_enabled").ilike("email", prof.email).maybeSingle();
        crmEnabled = !!adv?.crm_sync_enabled;
      }
    }

    const body = await req.json().catch(() => ({}));
    const op: string = body?.op || "";
    if (!op) return jsonResponse({ error: "missing op" }, 400);

    // Ops que leen/escriben contra el CRM: exigen habilitación server-side.
    const CRM_OPS = new Set(["search", "lookup", "create", "sync"]);
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
      const scopeParam = (!isAdmin && advisorEmail) ? `&advisor_email=${encodeURIComponent(advisorEmail)}` : "";
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
      const doc = (body.documento ?? anchor.identity.documento ?? "").trim();
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
      // Defensivo: un 404 rechaza; cualquier otro fallo del CRM deja pasar el
      // vínculo (no rompemos el flujo por un hipo de infra).
      try {
        await crmClient()(`/clients/${crmClientId}/`);
      } catch (e) {
        if ((e as any)?.status === 404) {
          return jsonResponse({ error: `El cliente #${crmClientId} no existe en el CRM.` }, 404);
        }
        console.warn("crm-sync link: no se pudo validar el cliente, se vincula igual:", (e as any)?.message || e);
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
      const doc = (body.document_number ?? anchor.identity.documento ?? "").trim();
      if (!first || !last || !doc) {
        return jsonResponse({ error: "first_name, last_name y document_number son obligatorios" }, 400);
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
        return jsonResponse({ ok: true, crm_client_id: null, pendientes: 0, detalle: { contactos: 0, agendados: 0, tareas: 0 } });
      }
      const { contactos, agendados, tareas } =
        await gatherByClient(supabase, anchor.effectiveClientId, anchor.agenteId);
      return jsonResponse({
        ok: true,
        crm_client_id: anchor.effectiveClientId,
        pendientes: contactos.length + agendados.length + tareas.length,
        detalle: { contactos: contactos.length, agendados: agendados.length, tareas: tareas.length },
      });
    }

    // ── sync ── vuelca el delta del cliente a la bitácora del CRM ────────────
    if (op === "sync") {
      if (!anchor.effectiveClientId) {
        return jsonResponse({ error: "El ítem no está vinculado a un cliente del CRM." }, 400);
      }
      const crm = crmClient();
      const clientId = anchor.effectiveClientId;
      const { contactos, agendados, tareas } =
        await gatherByClient(supabase, clientId, anchor.agenteId);

      if (!contactos.length && !agendados.length && !tareas.length) {
        return jsonResponse({ ok: true, action: "noop", synced: 0, message: "No hay gestión nueva para volcar." });
      }

      const colName = new Map<string, string>();
      const colIds = [...new Set(tareas.map((t) => t.columna_id).filter(Boolean))];
      if (colIds.length) {
        const { data: cols } = await supabase.from("abordaje_tareas_columnas")
          .select("id, titulo").in("id", colIds);
        for (const col of cols ?? []) colName.set(col.id, col.titulo);
      }

      const description = buildBitacora(contactos, agendados, tareas, colName);
      const log = await crm(`/clients/${clientId}/log/`, {
        method: "POST",
        body: JSON.stringify({ description, advisor_email: actingEmail, source: "abordaje" }),
      });

      const now = nowIso();
      const logId = log?.id ?? null;
      // El log YA se creó en el CRM. Marcamos las filas como sincronizadas; si el
      // marcado falla, NO respondemos "synced" limpio: avisamos, porque re-enviar
      // volcaría de nuevo esas gestiones (duplicado en la bitácora del CRM).
      const stamp = async (table: string, ids: string[]) => {
        if (!ids.length) return null;
        const { error } = await supabase.from(table)
          .update({ crm_log_id: logId, crm_synced_at: now }).in("id", ids);
        if (error) { console.error(`crm-sync stamp ${table} falló:`, error.message); return { table, error: error.message }; }
        return null;
      };
      const stampResults = await Promise.all([
        stamp("abordaje_prospecto_contactos", contactos.map((x) => x.id)),
        stamp("abordaje_agendados", agendados.map((x) => x.id)),
        stamp("abordaje_tareas", tareas.map((x) => x.id)),
      ]);
      const stampErrors = stampResults.filter(Boolean);
      const synced = contactos.length + agendados.length + tareas.length;

      if (stampErrors.length) {
        return jsonResponse({
          ok: true,
          action: "synced_unmarked",
          crm_log_id: logId,
          synced,
          detalle: { contactos: contactos.length, agendados: agendados.length, tareas: tareas.length },
          warning: "El log se creó en el CRM pero no se pudo marcar todo como sincronizado. NO vuelvas a sincronizar (podría duplicar la gestión en el CRM); avisá a soporte para reintentar el marcado.",
          stampErrors,
        });
      }

      return jsonResponse({
        ok: true,
        action: "synced",
        crm_log_id: logId,
        synced,
        detalle: { contactos: contactos.length, agendados: agendados.length, tareas: tareas.length },
      });
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
