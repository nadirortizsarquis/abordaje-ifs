// Un solo evento de Google Calendar por tarjeta de Abordaje (abordaje_tareas).
// Lo usan gcal-events (app de Abordaje y Universo, con JWT) y gcal-events-admin (MCP,
// con service role). Ver docs/CALENDAR_SIN_DUPLICADOS.md.
//
// Reglas que se aplican acá, en el servidor (no dependen de qué cliente pida el evento):
//  1. Un evento por tarjeta: un "create" de una tarjeta que ya tiene evento (se busca por
//     extendedProperties.private.abordaje_tarea_id) actualiza ese evento, no crea otro.
//  2. Id de evento derivado de la tarjeta ("abt" + uuid sin guiones): si dos pedidos
//     crean a la vez, el segundo recibe 409 de Google y reutiliza el existente.
//  3. Tarjeta con fecha y sin hora → evento de día completo (antes: 09:00 a 10:00).
//  4. El tipo de la tarjeta manda: recordatorio (lila, colorId 1) o reunión (color del
//     calendario, con Meet e invitados si la tarjeta lo pide). Duración = duracion_min.
//
// Las funciones puras (sin red) se exportan para los tests (tarea_evento_test.ts).

export const COLOR_RECORDATORIO = "1"; // Lavanda

export interface TareaEvento {
  id: string;
  agente_id: string;
  tipo_evento: "recordatorio" | "reunion";
  con_meet: boolean;
  invitados: string[];
  duracion_min: number;
  // Fecha y hora de la tarjeta. Sin hora → evento de día completo (no 09:00 a 10:00).
  fecha_recordatorio?: string | null;
  hora_recordatorio?: string | null;
}

// Id de Google válido: solo a-v y 0-9, entre 5 y 1024 caracteres. El uuid en hex ya cumple.
export function idEventoDeTarea(tareaId: string): string | null {
  const hex = String(tareaId || "").replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? `abt${hex}` : null;
}

export function tareaIdDelEvento(event: any): string | null {
  const v = event?.extendedProperties?.private?.abordaje_tarea_id;
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

// Mismo tope que la base (abordaje_tareas_invitados_check).
export const MAX_INVITADOS = 20;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function sumarMinutos(dateTime: string, min: number): string | null {
  // dateTime local sin zona ("2026-11-12T18:00:00") o con offset. Se suma sobre los
  // componentes para no depender de la zona del runtime.
  const m = String(dateTime).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(.*)$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + min, +(m[6] || 0)));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${m[7] || ""}`;
}

// "2026-11-12" → "2026-11-13" (fin exclusivo de un evento de día completo).
export function diaSiguiente(dia: string): string | null {
  const m = String(dia).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  return d.toISOString().slice(0, 10);
}

// Día de la tarjeta si no tiene hora (evento de día completo); null si tiene hora o no
// tiene fecha válida.
export function diaCompletoDe(tarea: TareaEvento): string | null {
  const f = String(tarea.fecha_recordatorio || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  return tarea.hora_recordatorio ? null : f;
}

// Aplica la tarjeta al cuerpo del evento. `crear` distingue alta de actualización (el color
// por defecto solo se pone al crear: si el usuario después lo cambia en Google, se respeta).
// `previo` = el evento que ya existe en Google (solo al actualizar): de ahí se conservan el
// Meet que ya tenga (pedir otro cambiaría el link) y los invitados agregados a mano.
export function aplicarTarea(event: any, tarea: TareaEvento, crear: boolean, previo: any = null): any {
  const ev = { ...event };
  const dur = Math.min(1440, Math.max(5, Number(tarea.duracion_min) || 60));
  const dia = ev.start ? diaCompletoDe(tarea) : null;
  const fin = dia ? diaSiguiente(dia) : null;
  if (dia && fin) {
    // Tarjeta sin hora → día completo, aunque el cliente mande una hora por defecto.
    // En un PATCH Google mezcla start/end con lo que ya tiene: hay que anular dateTime
    // explícitamente o queda {date, dateTime} y lo rechaza. En el alta no hace falta.
    ev.start = crear ? { date: dia } : { date: dia, dateTime: null };
    ev.end = crear ? { date: fin } : { date: fin, dateTime: null };
  } else if (ev.start?.dateTime) {
    const finHora = sumarMinutos(ev.start.dateTime, dur);
    if (finHora) ev.end = { ...(ev.end || {}), dateTime: finHora, timeZone: ev.start.timeZone || ev.end?.timeZone };
    // Si el evento era de día completo y ahora tiene hora, anular el date que ya tiene.
    if (!crear) {
      ev.start = { ...ev.start, date: null };
      if (ev.end) ev.end = { ...ev.end, date: null };
    }
  }
  if (tarea.tipo_evento === "reunion") {
    const invitados = (tarea.invitados || []).map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL.test(x)).slice(0, MAX_INVITADOS);
    if (invitados.length) {
      // Unión con los que ya tiene el evento (PATCH de attendees reemplaza la lista entera).
      const previos: any[] = Array.isArray(previo?.attendees) ? previo.attendees : [];
      const ya = new Set(previos.map((a) => String(a.email || "").toLowerCase()));
      ev.attendees = [...previos, ...invitados.filter((e) => !ya.has(e)).map((email) => ({ email }))];
    }
    const yaTieneMeet = !!(previo?.conferenceData?.entryPoints?.length || previo?.hangoutLink);
    if (tarea.con_meet && !ev.conferenceData && !yaTieneMeet) {
      ev.conferenceData = { createRequest: { requestId: `abt-${tarea.id}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
    }
    if (yaTieneMeet) delete ev.conferenceData; // nunca tocar un Meet existente
    if (crear) delete ev.colorId; // azul = color del calendario
    // Pasó de recordatorio a reunión: se le saca el lila que le puso Abordaje (un color que
    // eligió el usuario se respeta). null en un PATCH vuelve al color del calendario.
    else if (previo?.colorId === COLOR_RECORDATORIO) ev.colorId = null;
  } else if (crear && !ev.colorId) {
    ev.colorId = COLOR_RECORDATORIO;
  }
  return ev;
}

// Avisos por mail: solo reuniones con invitados (a los recordatorios no hay a quién avisar).
export function sendUpdatesPara(tarea: TareaEvento | null): "all" | "none" {
  return tarea?.tipo_evento === "reunion" && (tarea.invitados || []).length ? "all" : "none";
}

// ── Blindaje: las notas internas NUNCA van a invitados externos (A1, 11-nov-2026) ──
// La descripción de un evento de tarjeta es la bitácora interna (observacion). Google
// se la muestra (y la manda por mail) a todos los invitados. Regla de Nadir: si el evento
// tiene AL MENOS UN invitado ajeno a la organización, la descripción se reemplaza por un
// texto neutro, y el título también (decisión de Nadir, 11-nov). Excepción: lo que el agente
// escribió A MANO en Google (lo revisó él) se respeta. Para distinguirlo, cada escritura de
// Abordaje deja en las propiedades privadas del evento (no las ven los invitados) una huella
// del título y la descripción que escribió; si en Google ya no coinciden, los editó alguien
// a mano. Sin huella (evento viejo) se asume que es de Abordaje (fail-closed). Se aplica acá, en el único punto por donde pasan TODAS las
// escrituras a Google (escribirEvento), así cubre a Abordaje, Universo, el MCP y el
// reconciliador sin depender del cliente. Fail-closed: si no se puede saber quiénes son
// los invitados, se asume que hay externos.
export const DESCRIPCION_NEUTRA = "Reunión agendada con IFS - Insurance Financial Solution.";
export const TITULO_NEUTRO = "Reunión con IFS";
// Opción (b) de Nadir (11-nov): la bitácora NUNCA va a Google, en ningún evento de tarjeta o
// de prospecto (haya o no invitados). La nota se ve en Abordaje / Universo, que la leen de
// la base. Así, si alguien agrega un invitado a mano en Google, no hay notas que se filtren.
export const DESCRIPCION_SIN_NOTAS = "Agendado desde IFS. El detalle está en Abordaje / Universo IFS.";
const HUELLA = { summary: "abordaje_sum_h", description: "abordaje_desc_h" } as const;

// Huella corta (no es criptográfica: solo detecta si el texto cambió).
export function huella(txt: string): string {
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ¿Ese campo del evento lo escribió alguien a mano en Google?
export function esManual(previo: any, campo: "summary" | "description"): boolean {
  const v = previo?.[campo];
  if (!v || v === DESCRIPCION_NEUTRA || v === DESCRIPCION_SIN_NOTAS || v === TITULO_NEUTRO) return false;
  const h = previo?.extendedProperties?.private?.[HUELLA[campo]];
  return !!h && huella(String(v)) !== h;
}
export const DOMINIOS_INTERNOS = ["ifs-broker.com"];

// Emails de invitados de uno o más eventos (las salas/recursos no cuentan).
export function emailsInvitados(...eventos: any[]): string[] {
  const out: string[] = [];
  for (const ev of eventos) {
    for (const a of (Array.isArray(ev?.attendees) ? ev.attendees : [])) {
      if (a?.resource) continue;
      const e = String(a?.email || "").trim().toLowerCase();
      if (e) out.push(e);
    }
  }
  return out;
}

// Interno = dominio de la organización o email de una cuenta de la plataforma (auth.users).
export function esInterno(email: string, internos: Set<string>): boolean {
  const e = String(email || "").trim().toLowerCase();
  const dom = e.split("@")[1] || "";
  return DOMINIOS_INTERNOS.includes(dom) || internos.has(e);
}

// ¿El evento (como va a quedar) tiene invitados externos? Se mira la unión de lo que se
// manda y lo que ya tiene en Google: un PATCH sin attendees conserva los que había.
export function hayExternos(event: any, previo: any, internos: Set<string>): boolean {
  if (event?.attendeesOmitted || previo?.attendeesOmitted) return true; // lista incompleta
  return emailsInvitados(event, previo).some((e) => !esInterno(e, internos));
}

// Cuerpo listo para mandar.
//  - Evento de TARJETA o de PROSPECTO (deAbordaje=true): la descripción nunca lleva la nota
//    de Abordaje: con invitados externos va la neutra; sin externos, un aviso de que el
//    detalle está en la plataforma. Con externos además el título es neutro. Lo que el
//    agente escribió A MANO en Google se respeta (no se manda). Siempre deja la huella.
//  - Evento propio del usuario en Google o agenda suelta (deAbordaje=false): con externos
//    solo se neutraliza la descripción que manda Abordaje; el resto no se toca (la nota de
//    una agenda suelta vive solo en Google).
export function blindarCuerpo(event: any, externos: boolean, deAbordaje = true, previo: any = null): any {
  const ev = { ...(event || {}) };
  if (!deAbordaje) {
    if (externos && "description" in ev) ev.description = DESCRIPCION_NEUTRA;
    return ev;
  }
  if (esManual(previo, "description")) delete ev.description;
  else ev.description = externos ? DESCRIPCION_NEUTRA : DESCRIPCION_SIN_NOTAS;
  if (externos) {
    if (esManual(previo, "summary")) delete ev.summary; else ev.summary = TITULO_NEUTRO;
  }
  const priv: Record<string, string> = { ...(previo?.extendedProperties?.private || {}), ...(ev.extendedProperties?.private || {}) };
  for (const campo of ["summary", "description"] as const) {
    const final = campo in ev ? ev[campo] : previo?.[campo];
    if (typeof final === "string" && final) priv[HUELLA[campo]] = huella(final);
  }
  ev.extendedProperties = { ...(ev.extendedProperties || {}), private: priv };
  return ev;
}

// Emails de las cuentas de la plataforma (auth.users, no profiles.email: esa columna no
// es la identidad real). Perezoso y memoizado: solo se consulta si el evento tiene
// invitados. Si falla, queda vacío → solo el dominio cuenta como interno (fail-closed).
export function internosPerezosos(supabase: any): () => Promise<Set<string>> {
  let p: Promise<Set<string>> | null = null;
  return () => p ??= (async () => {
    const s = new Set<string>();
    try {
      for (let page = 1; page <= 10; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) break;
        const users = data?.users || [];
        for (const u of users) if (u?.email) s.add(String(u.email).toLowerCase());
        if (users.length < 1000) break;
      }
    } catch (_) { /* fail-closed */ }
    return s;
  })();
}

export interface CtxEscritura { internos: () => Promise<Set<string>> }

// ÚNICO punto de escritura de eventos a Google (POST/PATCH). Ningún otro código debe
// hacer fetch con POST/PATCH a /events (lo verifica tarea_evento_test.ts).
// `previo`: el evento actual en Google; null = alta; undefined = se lee acá (PATCH).
export async function escribirEvento(
  url: string, method: "POST" | "PATCH", headers: Record<string, string>, event: any, previo: any, ctx: CtxEscritura,
  fetcher: typeof fetch = fetch, tarjeta = true,
): Promise<Response> {
  let actual = previo;
  let externos = false;
  if (actual === undefined) {
    actual = null;
    const g = await fetcher(url.split("?")[0], { headers });
    if (g.ok) actual = await g.json();
    else if (g.status !== 404 && g.status !== 410) externos = true; // no se pudo leer → fail-closed
  }
  if (!externos) {
    if (event?.attendeesOmitted || actual?.attendeesOmitted) externos = true;
    else if (emailsInvitados(event, actual).length) externos = hayExternos(event, actual, await ctx.internos());
  }
  if (externos) console.warn(`blindaje: evento con invitados externos, título y descripción neutros (${method})`);
  // Las citas de prospecto (no son tarjeta) también llevan notas de la base: mismo trato.
  const dePro = !!(event?.extendedProperties?.private?.abordaje_prospect_id || actual?.extendedProperties?.private?.abordaje_prospect_id);
  const cuerpo = blindarCuerpo(event, externos, tarjeta || dePro, actual);
  // Mail a invitados solo si cambia algo que les importa (se decide sobre el cuerpo final).
  let destino = url;
  if (actual && /[?&]sendUpdates=all/.test(url) && !cambiaParaInvitados(cuerpo, actual)) destino = url.replace(/sendUpdates=all/, "sendUpdates=none");
  return await fetcher(destino, { method, headers, body: JSON.stringify(cuerpo) });
}

// ¿El cambio le importa a los invitados? (para no mandarles un mail por cada nota).
const hm = (x: any) => String(x?.dateTime || x?.date || "").slice(0, 16);
export function cambiaParaInvitados(body: any, previo: any): boolean {
  if (!previo) return true;
  if (body?.conferenceData?.createRequest) return true;
  if (body?.start && hm(body.start) !== hm(previo.start)) return true;
  if (body?.end && hm(body.end) !== hm(previo.end)) return true;
  if (body?.summary !== undefined && body.summary !== previo.summary) return true;
  if (body?.location !== undefined && (body.location || "") !== (previo.location || "")) return true;
  const ya = new Set(emailsInvitados(previo));
  return emailsInvitados(body).some((e) => !ya.has(e));
}

// ── Con red ────────────────────────────────────────────────────────────────────

// La tarjeta del evento, solo si es del agente dueño del calendario. Si el evento dice
// ser de una tarjeta ajena, se ignora la tarjeta (no se aplica nada ni se deduplica).
export async function cargarTarea(supabase: any, event: any, agenteId: string): Promise<TareaEvento | null> {
  const id = tareaIdDelEvento(event);
  if (!id) return null;
  const { data } = await supabase.from("abordaje_tareas")
    .select("id, agente_id, tipo_evento, con_meet, invitados, duracion_min, fecha_recordatorio, hora_recordatorio")
    .eq("id", id).maybeSingle();
  if (!data || data.agente_id !== agenteId) return null;
  return data as TareaEvento;
}

// ── Cambio de calendario (Ajustes → Calendario) ────────────────────────────────
// Al elegir otro calendario, los eventos que ya existen quedan en el anterior. Las
// funciones apuntan al calendario nuevo y reciben 404: entonces se busca el evento en
// los calendarios donde el usuario puede escribir y se lo mueve (o se lo borra allá).
const CAL_API = "https://www.googleapis.com/calendar/v3";

export function calendarioDeBase(base: string): string | null {
  const m = String(base).match(/\/calendars\/([^/]+)\/events/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Calendarios propios del usuario (owner), siguiendo la paginación. Solo los propios:
// en un calendario compartido por un colega una reunión tiene el MISMO id de evento que
// en el nuestro, y no hay que tocar esa copia.
async function calendariosPropios(headers: Record<string, string>): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${CAL_API}/users/me/calendarList?minAccessRole=owner&maxResults=250${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { headers });
    if (!r.ok) break;
    const data = await r.json();
    for (const cal of (data.items || []) as any[]) if (cal?.id) ids.push(cal.primary ? "primary" : cal.id);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids;
}

// Evento de Abordaje: lo creó o tocó la app/MCP (tarjeta, prospecto o agenda).
export function esEventoDeAbordaje(ev: any): boolean {
  const p = ev?.extendedProperties?.private || {};
  return !!(p.abordaje_tarea_id || p.abordaje_prospect_id || p.abordaje_agente_id);
}

// Id del calendario propio (distinto de `excepto`) donde está vivo el evento de Abordaje
// con ese id, o null. Las consultas van en paralelo.
export async function buscarCalendarioDelEvento(
  headers: Record<string, string>, eventId: string, excepto: string | null,
): Promise<string | null> {
  const cals = (await calendariosPropios(headers)).filter((c) => c !== excepto);
  const encontrados = await Promise.all(cals.map(async (cal) => {
    const g = await fetch(`${CAL_API}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`, { headers });
    if (!g.ok) return null;
    const ev = await g.json();
    return ev?.status !== "cancelled" && esEventoDeAbordaje(ev) ? cal : null;
  }));
  return encontrados.find(Boolean) || null;
}

// Mueve un evento al calendario de `base`. true si quedó movido.
async function moverEventoA(base: string, headers: Record<string, string>, eventId: string, origen: string): Promise<boolean> {
  const destino = calendarioDeBase(base);
  if (!destino) return false;
  const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(origen)}/events/${encodeURIComponent(eventId)}/move?destination=${encodeURIComponent(destino)}&sendUpdates=none`, {
    method: "POST", headers,
  });
  return r.ok;
}

// Borra un evento que no estaba en el calendario de `base` (se cambió de calendario).
// Devuelve true si lo encontró y lo borró en otro calendario.
export async function borrarEnOtroCalendario(base: string, headers: Record<string, string>, eventId: string): Promise<boolean> {
  const origen = await buscarCalendarioDelEvento(headers, eventId, calendarioDeBase(base));
  if (!origen) return false;
  const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(origen)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE", headers });
  return r.ok || r.status === 404 || r.status === 410;
}

function urlCon(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

async function patchEvento(base: string, headers: Record<string, string>, eventId: string, event: any, tarea: TareaEvento | null, previo: any, ctx: CtxEscritura) {
  const r = await escribirEvento(urlCon(`${base}/${encodeURIComponent(eventId)}`, { conferenceDataVersion: "1", sendUpdates: sendUpdatesPara(tarea) }), "PATCH", headers, event, previo ?? undefined, ctx);
  if (!r.ok) {
    const err: any = new Error(`update failed: ${r.status} ${await r.text()}`);
    err.status = r.status;
    throw err;
  }
  return await r.json();
}

// Crea el evento de una tarjeta sin duplicar. Devuelve { event, reutilizado }.
export async function crearEventoTarea(
  base: string, headers: Record<string, string>, event: any, tarea: TareaEvento, ctx: CtxEscritura,
): Promise<{ event: any; reutilizado: boolean }> {
  const cuerpo = aplicarTarea(event, tarea, true);

  // 1. ¿La tarjeta ya tiene un evento vivo? → se actualiza ese.
  const buscar = urlCon(base, { privateExtendedProperty: `abordaje_tarea_id=${tarea.id}`, maxResults: "5", showDeleted: "false" });
  const lr = await fetch(buscar, { headers });
  if (lr.ok) {
    const vivos = ((await lr.json()).items || []).filter((e: any) => e.status !== "cancelled");
    if (vivos.length) {
      const { colorId: _c, ...sinColor } = event; // no pisar el color que ya tiene
      return { event: await patchEvento(base, headers, vivos[0].id, aplicarTarea(sinColor, tarea, false, vivos[0]), tarea, vivos[0], ctx), reutilizado: true };
    }
  }

  // 1b. El agente eligió otro calendario en Ajustes y el evento quedó en el principal:
  //     se lo mueve al calendario elegido en vez de crear un segundo evento.
  const destino = calendarioDeBase(base);
  if (destino && destino !== "primary") {
    const enPrincipal = await fetch(urlCon(`${CAL_API}/calendars/primary/events`, { privateExtendedProperty: `abordaje_tarea_id=${tarea.id}`, maxResults: "5", showDeleted: "false" }), { headers });
    if (enPrincipal.ok) {
      const viejo = ((await enPrincipal.json()).items || []).find((e: any) => e.status !== "cancelled");
      if (viejo && await moverEventoA(base, headers, viejo.id, "primary")) {
        const { colorId: _c, ...sinColor } = event;
        return { event: await patchEvento(base, headers, viejo.id, aplicarTarea(sinColor, tarea, false, viejo), tarea, viejo, ctx), reutilizado: true };
      }
    }
  }

  // 2. Alta con id derivado de la tarjeta (anti-carrera).
  const idFijo = idEventoDeTarea(tarea.id);
  const alta = (cuerpoAlta: any) => escribirEvento(urlCon(base, { conferenceDataVersion: "1", sendUpdates: sendUpdatesPara(tarea) }), "POST", headers, cuerpoAlta, null, ctx);
  let r = await alta(idFijo ? { ...cuerpo, id: idFijo } : cuerpo);
  if (r.status === 409 && idFijo) {
    // Ya existe un evento con ese id: si está vivo, lo creó otro pedido en paralelo → se
    // reutiliza. Si fue borrado, Google no deja reusar el id → alta con id aleatorio.
    const gr = await fetch(`${base}/${idFijo}`, { headers });
    const previo = gr.ok ? await gr.json() : null;
    if (previo && previo.status !== "cancelled") {
      const { colorId: _c, ...sinColor } = event;
      return { event: await patchEvento(base, headers, idFijo, aplicarTarea(sinColor, tarea, false, previo), tarea, previo, ctx), reutilizado: true };
    }
    r = await alta(cuerpo);
  }
  if (!r.ok) throw new Error(`create failed: ${r.status} ${await r.text()}`);
  return { event: await r.json(), reutilizado: false };
}

export async function actualizarEventoTarea(
  base: string, headers: Record<string, string>, eventId: string, event: any, tarea: TareaEvento, ctx: CtxEscritura,
): Promise<any> {
  // Se lee SIEMPRE el evento actual: para no pisar el Meet ni los invitados de una reunión,
  // y para saber si tiene invitados externos (blindaje), aunque la tarjeta sea recordatorio.
  const leer = async () => {
    const gr = await fetch(`${base}/${encodeURIComponent(eventId)}`, { headers });
    return gr.ok ? await gr.json() : undefined; // undefined: escribirEvento relee o asume externos
  };
  let previo: any = await leer();
  try {
    return await patchEvento(base, headers, eventId, aplicarTarea(event, tarea, false, previo ?? null), tarea, previo, ctx);
  } catch (e: any) {
    // 404: el evento está en el calendario anterior (el agente cambió de calendario).
    // Se lo mueve al actual y se reintenta una vez.
    if (e?.status !== 404) throw e;
    const origen = await buscarCalendarioDelEvento(headers, eventId, calendarioDeBase(base));
    if (!origen || !(await moverEventoA(base, headers, eventId, origen))) throw e;
    previo = await leer();
    return await patchEvento(base, headers, eventId, aplicarTarea(event, tarea, false, previo ?? null), tarea, previo, ctx);
  }
}
