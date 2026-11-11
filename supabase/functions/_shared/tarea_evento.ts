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
    const invitados = (tarea.invitados || []).map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL.test(x));
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
  } else if (crear && !ev.colorId) {
    ev.colorId = COLOR_RECORDATORIO;
  }
  return ev;
}

// Avisos por mail: solo reuniones con invitados (a los recordatorios no hay a quién avisar).
export function sendUpdatesPara(tarea: TareaEvento | null): "all" | "none" {
  return tarea?.tipo_evento === "reunion" && (tarea.invitados || []).length ? "all" : "none";
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

// Id del calendario (distinto de `excepto`) donde está vivo el evento, o null.
export async function buscarCalendarioDelEvento(
  headers: Record<string, string>, eventId: string, excepto: string | null,
): Promise<string | null> {
  const r = await fetch(`${CAL_API}/users/me/calendarList?minAccessRole=writer&maxResults=50`, { headers });
  if (!r.ok) return null;
  for (const cal of ((await r.json()).items || []) as any[]) {
    if (!cal?.id || cal.id === excepto || (excepto === "primary" && cal.primary)) continue;
    const g = await fetch(`${CAL_API}/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(eventId)}`, { headers });
    if (!g.ok) continue;
    const ev = await g.json();
    if (ev?.status !== "cancelled") return cal.id;
  }
  return null;
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

async function patchEvento(base: string, headers: Record<string, string>, eventId: string, event: any, tarea: TareaEvento | null) {
  const r = await fetch(urlCon(`${base}/${encodeURIComponent(eventId)}`, { conferenceDataVersion: "1", sendUpdates: sendUpdatesPara(tarea) }), {
    method: "PATCH", headers, body: JSON.stringify(event),
  });
  if (!r.ok) {
    const err: any = new Error(`update failed: ${r.status} ${await r.text()}`);
    err.status = r.status;
    throw err;
  }
  return await r.json();
}

// Crea el evento de una tarjeta sin duplicar. Devuelve { event, reutilizado }.
export async function crearEventoTarea(
  base: string, headers: Record<string, string>, event: any, tarea: TareaEvento,
): Promise<{ event: any; reutilizado: boolean }> {
  const cuerpo = aplicarTarea(event, tarea, true);

  // 1. ¿La tarjeta ya tiene un evento vivo? → se actualiza ese.
  const buscar = urlCon(base, { privateExtendedProperty: `abordaje_tarea_id=${tarea.id}`, maxResults: "5", showDeleted: "false" });
  const lr = await fetch(buscar, { headers });
  if (lr.ok) {
    const vivos = ((await lr.json()).items || []).filter((e: any) => e.status !== "cancelled");
    if (vivos.length) {
      const { colorId: _c, ...sinColor } = event; // no pisar el color que ya tiene
      return { event: await patchEvento(base, headers, vivos[0].id, aplicarTarea(sinColor, tarea, false, vivos[0]), tarea), reutilizado: true };
    }
  }

  // 2. Alta con id derivado de la tarjeta (anti-carrera).
  const idFijo = idEventoDeTarea(tarea.id);
  const alta = (cuerpoAlta: any) => fetch(urlCon(base, { conferenceDataVersion: "1", sendUpdates: sendUpdatesPara(tarea) }), {
    method: "POST", headers, body: JSON.stringify(cuerpoAlta),
  });
  let r = await alta(idFijo ? { ...cuerpo, id: idFijo } : cuerpo);
  if (r.status === 409 && idFijo) {
    // Ya existe un evento con ese id: si está vivo, lo creó otro pedido en paralelo → se
    // reutiliza. Si fue borrado, Google no deja reusar el id → alta con id aleatorio.
    const gr = await fetch(`${base}/${idFijo}`, { headers });
    const previo = gr.ok ? await gr.json() : null;
    if (previo && previo.status !== "cancelled") {
      const { colorId: _c, ...sinColor } = event;
      return { event: await patchEvento(base, headers, idFijo, aplicarTarea(sinColor, tarea, false, previo), tarea), reutilizado: true };
    }
    r = await alta(cuerpo);
  }
  if (!r.ok) throw new Error(`create failed: ${r.status} ${await r.text()}`);
  return { event: await r.json(), reutilizado: false };
}

export async function actualizarEventoTarea(
  base: string, headers: Record<string, string>, eventId: string, event: any, tarea: TareaEvento,
): Promise<any> {
  // Reuniones: leer el evento actual para no pisar su Meet ni sus invitados.
  let previo: any = null;
  if (tarea.tipo_evento === "reunion") {
    const gr = await fetch(`${base}/${encodeURIComponent(eventId)}`, { headers });
    if (gr.ok) previo = await gr.json();
  }
  try {
    return await patchEvento(base, headers, eventId, aplicarTarea(event, tarea, false, previo), tarea);
  } catch (e: any) {
    // 404: el evento está en el calendario anterior (el agente cambió de calendario).
    // Se lo mueve al actual y se reintenta una vez.
    if (e?.status !== 404) throw e;
    const origen = await buscarCalendarioDelEvento(headers, eventId, calendarioDeBase(base));
    if (!origen || !(await moverEventoA(base, headers, eventId, origen))) throw e;
    if (tarea.tipo_evento === "reunion" && !previo) {
      const gr = await fetch(`${base}/${encodeURIComponent(eventId)}`, { headers });
      if (gr.ok) previo = await gr.json();
    }
    return await patchEvento(base, headers, eventId, aplicarTarea(event, tarea, false, previo), tarea);
  }
}
