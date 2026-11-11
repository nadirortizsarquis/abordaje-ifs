// deno run tarea_evento_test.ts — lógica pura de "un evento por tarjeta".
import { blindarCuerpo, cambiaParaInvitados, DESCRIPCION_NEUTRA, TITULO_NEUTRO, huella, esManual, esInterno, escribirEvento, hayExternos, aplicarTarea, calendarioDeBase, esEventoDeAbordaje, MAX_INVITADOS, COLOR_RECORDATORIO, diaSiguiente, idEventoDeTarea, sendUpdatesPara, tareaIdDelEvento, type TareaEvento } from "./tarea_evento.ts";

let ok = 0, mal = 0;
const check = (cond: boolean, msg: string) => { if (cond) { ok++; console.log("ok ", msg); } else { mal++; console.log("MAL", msg); } };

const T = (x: Partial<TareaEvento> = {}): TareaEvento => ({
  id: "c229c046-9038-4058-adb2-8b6b2659135a", agente_id: "a", tipo_evento: "recordatorio",
  con_meet: false, invitados: [], duracion_min: 60, ...x,
});
const EV = { summary: "X", start: { dateTime: "2026-11-12T18:00:00", timeZone: "America/Argentina/Buenos_Aires" }, end: { dateTime: "2026-11-12T19:00:00", timeZone: "America/Argentina/Buenos_Aires" },
  extendedProperties: { private: { abordaje_tarea_id: "c229c046-9038-4058-adb2-8b6b2659135a" } } };

// id derivado
const id = idEventoDeTarea("c229c046-9038-4058-adb2-8b6b2659135a")!;
check(id === "abtc229c04690384058adb28b6b2659135a", "id = abt + uuid sin guiones");
check(/^[a-v0-9]{5,1024}$/.test(id), "id válido para Google (a-v, 0-9)");
check(idEventoDeTarea("no-es-uuid") === null, "id inválido → null");
check(tareaIdDelEvento(EV) === "c229c046-9038-4058-adb2-8b6b2659135a", "lee abordaje_tarea_id");
check(tareaIdDelEvento({ extendedProperties: { private: { abordaje_tarea_id: "x' or 1=1" } } }) === null, "tarea_id con formato raro → null");

// recordatorio
const r1 = aplicarTarea(EV, T(), true);
check(r1.colorId === COLOR_RECORDATORIO, "recordatorio nuevo → lila");
check(aplicarTarea({ ...EV, colorId: "5" }, T(), true).colorId === "5", "si el cliente manda color, se respeta");
check(aplicarTarea(EV, T(), false).colorId === undefined, "al actualizar no se toca el color");
check(!r1.attendees && !r1.conferenceData, "recordatorio sin invitados ni Meet");
check(sendUpdatesPara(T()) === "none", "recordatorio no manda mails");

// duración
check(aplicarTarea(EV, T({ duracion_min: 30 }), true).end.dateTime === "2026-11-12T18:30:00", "duración 30 min");
check(aplicarTarea({ ...EV, start: { dateTime: "2026-11-12T23:30:00" } }, T({ duracion_min: 60 }), true).end.dateTime === "2026-11-13T00:30:00", "cruza medianoche");
check(aplicarTarea({ ...EV, start: { dateTime: "2026-11-12T18:00:00-03:00" } }, T(), true).end.dateTime === "2026-11-12T19:00:00-03:00", "conserva el offset");

// reunión
const reu = T({ tipo_evento: "reunion", con_meet: true, invitados: ["Cliente@Mail.com", "no-es-mail"] });
const r2 = aplicarTarea({ ...EV, colorId: "3" }, reu, true);
check(r2.colorId === undefined, "reunión nueva → color del calendario (azul)");
check(r2.attendees?.length === 1 && r2.attendees[0].email === "cliente@mail.com", "invitados válidos, en minúscula");
check(r2.conferenceData?.createRequest?.conferenceSolutionKey?.type === "hangoutsMeet", "pide Meet");
check(sendUpdatesPara(reu) === "all", "reunión con invitados avisa por mail");
check(sendUpdatesPara(T({ tipo_evento: "reunion" })) === "none", "reunión sin invitados no manda mails");

// reunión existente: no tocar su Meet ni sacar invitados
const previo = { hangoutLink: "https://meet.google.com/abc", conferenceData: { entryPoints: [{ uri: "x" }] }, attendees: [{ email: "otro@x.com" }] };
const r3 = aplicarTarea(EV, reu, false, previo);
check(r3.conferenceData === undefined, "reunión con Meet: no pide otro (no cambia el link)");
check(r3.attendees.map((a: any) => a.email).join() === "otro@x.com,cliente@mail.com", "suma invitados sin sacar los que ya estaban");
check(aplicarTarea(EV, T({ tipo_evento: "reunion" }), false, previo).attendees === undefined, "sin invitados en la tarjeta: no toca los del evento");

// día completo (tarjeta con fecha y sin hora)
const SH = T({ fecha_recordatorio: "2026-11-12", hora_recordatorio: null });
const d1 = aplicarTarea(EV, SH, true);
check(d1.start.date === "2026-11-12" && d1.start.dateTime === undefined, "sin hora: alta de día completo (sin dateTime)");
check(d1.end.date === "2026-11-13" && d1.end.dateTime === undefined, "sin hora: fin = día siguiente");
check(d1.colorId === COLOR_RECORDATORIO, "sin hora: sigue siendo lila");
const d2 = aplicarTarea(EV, SH, false);
check(d2.start.date === "2026-11-12" && d2.start.dateTime === null && d2.end.dateTime === null, "sin hora al actualizar: dateTime en null explícito");
check(diaSiguiente("2026-12-31") === "2027-01-01" && diaSiguiente("2028-02-28") === "2028-02-29", "día siguiente cruza año y bisiesto");
const CH = T({ fecha_recordatorio: "2026-11-12", hora_recordatorio: "18:00" });
const d3 = aplicarTarea(EV, CH, false);
check(d3.start.dateTime === "2026-11-12T18:00:00" && d3.start.date === null && d3.end.date === null, "con hora al actualizar: date en null (de día completo a horario)");
const d4 = aplicarTarea(EV, CH, true);
check(d4.start.date === undefined && d4.end.dateTime === "2026-11-12T19:00:00", "con hora al crear: igual que antes");
check(aplicarTarea({ summary: "solo título" }, SH, false).start === undefined, "update sin start: no toca fechas");
check(aplicarTarea(EV, T(), false).start.date === null, "tarjeta vieja sin fecha cargada: evento con hora");

// cambio de calendario
check(calendarioDeBase("https://www.googleapis.com/calendar/v3/calendars/abc%40group.calendar.google.com/events") === "abc@group.calendar.google.com", "calendario de la URL base");
check(calendarioDeBase("https://www.googleapis.com/calendar/v3/calendars/primary/events") === "primary", "calendario principal");

check(esEventoDeAbordaje(EV) && !esEventoDeAbordaje({ id: "x" }), "solo se buscan/mueven eventos de Abordaje");
const muchos = Array.from({ length: 30 }, (_, i) => `p${i}@x.com`);
check(aplicarTarea(EV, T({ tipo_evento: "reunion", invitados: muchos }), true).attendees.length === MAX_INVITADOS, "tope de invitados = el de la base (20)");

// reunión que venía de recordatorio: se le saca el lila; un color elegido se respeta
check(aplicarTarea(EV, reu, false, { colorId: "1" }).colorId === null, "recordatorio→reunión: saca el lila (azul)");
check(aplicarTarea(EV, reu, false, { colorId: "5" }).colorId === undefined, "reunión con color elegido: se respeta");

// ── Blindaje A1: las notas internas NUNCA van a invitados externos ──
const INT = new Set(["fede.socio@gmail.com", "nadir@gmail.com"]);
check(esInterno("x@ifs-broker.com", new Set()) && esInterno("FEDE.socio@gmail.com", INT), "internos: dominio IFS o cuenta de la plataforma");
check(!esInterno("cliente@gmail.com", INT) && !esInterno("x@ifs-broker.com.evil.com", INT), "externos: gmail ajeno o dominio parecido");
check(!hayExternos({ attendees: [{ email: "x@ifs-broker.com" }, { email: "nadir@gmail.com" }] }, null, INT), "solo internos → no hay externos");
check(hayExternos({ attendees: [{ email: "x@ifs-broker.com" }, { email: "cliente@mail.com" }] }, null, INT), "un externo alcanza");
check(hayExternos({ summary: "PATCH sin attendees" }, { attendees: [{ email: "cliente@mail.com" }] }, INT), "PATCH sin attendees: cuentan los que ya tiene en Google");
check(hayExternos({}, { attendeesOmitted: true }, INT), "lista de invitados incompleta → se asume externo");
check(!hayExternos({ attendees: [{ email: "sala@resource.calendar.google.com", resource: true }] }, null, INT), "salas no cuentan");
const bl = blindarCuerpo({ summary: "Juan Perez - hipertension", description: "BITACORA SECRETA" }, true);
check(bl.description === DESCRIPCION_NEUTRA && bl.summary === TITULO_NEUTRO, "con externos: título y descripción neutros");
const bl2 = blindarCuerpo({}, true);
check(bl2.description === DESCRIPCION_NEUTRA && bl2.summary === TITULO_NEUTRO, "con externos se pisan aunque no vengan");
check(blindarCuerpo({ description: "nota" }, false).description === "nota", "sin externos la nota se conserva");
// Lo que el agente escribió a mano en Google se respeta (huella de Abordaje distinta).
const PRIV = (sum: string, desc: string) => ({ extendedProperties: { private: { abordaje_tarea_id: "t1", abordaje_sum_h: huella(sum), abordaje_desc_h: huella(desc) } } });
const manual = { summary: "Reunión Juan - revisión de póliza", description: "Agenda: revisar póliza y beneficiarios", ...PRIV("Juan Perez - hipertension", "BITACORA") };
check(esManual(manual, "summary") && esManual(manual, "description"), "detecta título y descripción editados a mano en Google");
const bm = blindarCuerpo({ summary: "Juan Perez - hipertension", description: "BITACORA NUEVA" }, true, true, manual);
check(!("description" in bm) && !("summary" in bm), "con externos, lo manual se respeta: no se mandan título ni bitácora");
const deAbordaje = { summary: "Juan Perez - hipertension", description: "BITACORA", ...PRIV("Juan Perez - hipertension", "BITACORA") };
const ba = blindarCuerpo({ description: "BITACORA + nota" }, true, true, deAbordaje);
check(ba.description === DESCRIPCION_NEUTRA && ba.summary === TITULO_NEUTRO, "lo que escribió Abordaje se neutraliza");
const legacy = { summary: "Juan Perez - hipertension", description: "BITACORA" };
check(!esManual(legacy, "description") && blindarCuerpo({}, true, true, legacy).description === DESCRIPCION_NEUTRA, "evento viejo sin huella: se asume de Abordaje (fail-closed)");
check(ba.extendedProperties.private.abordaje_tarea_id === "t1", "al dejar la huella no se pierde abordaje_tarea_id");
check(ba.extendedProperties.private.abordaje_desc_h === huella(DESCRIPCION_NEUTRA), "deja la huella de lo que quedó escrito");
const sinExt = blindarCuerpo({ summary: "T", description: "B" }, false, true, null);
check(sinExt.description === "B" && sinExt.extendedProperties.private.abordaje_desc_h === huella("B"), "sin externos: nota intacta + huella");
check(blindarCuerpo({ start: {} }, true, false).description === undefined, "evento propio de Google: si Abordaje no manda descripción, no se toca la del usuario");
check(blindarCuerpo({ description: "nota de agenda" }, true, false).description === DESCRIPCION_NEUTRA, "evento propio de Google: la descripción que manda Abordaje se neutraliza igual");

// escribirEvento con fetch simulado: nunca sale la bitácora hacia un evento con externos.
const fakeFetch = (eventoEnGoogle: any, status = 200) => {
  const enviados: any[] = [];
  const f = (async (url: string, init?: any) => {
    if (!init?.method) return new Response(JSON.stringify(eventoEnGoogle), { status });
    enviados.push(JSON.parse(init.body));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { f, enviados };
};
const ctxT = { internos: async () => INT };
const BIT = "[11/11/26 10:00] hipertension, ofrecer 15% de descuento";
{
  const { f, enviados } = fakeFetch(null);
  await escribirEvento("https://x/events", "POST", {}, { description: BIT, attendees: [{ email: "cliente@mail.com" }] }, null, ctxT, f);
  check(enviados[0].description === DESCRIPCION_NEUTRA, "alta con invitado externo → sin bitácora");
}
{
  const { f, enviados } = fakeFetch({ attendees: [{ email: "cliente@mail.com" }], description: "vieja" });
  await escribirEvento("https://x/events/abc?sendUpdates=all", "PATCH", {}, { description: BIT }, undefined, ctxT, f);
  check(enviados[0].description === DESCRIPCION_NEUTRA, "PATCH de nota sobre evento con externo (invitado agregado en Google) → sin bitácora");
}
{
  const { f, enviados } = fakeFetch(null, 500);
  await escribirEvento("https://x/events/abc", "PATCH", {}, { description: BIT }, undefined, ctxT, f);
  check(enviados[0].description === DESCRIPCION_NEUTRA, "no se pudo leer el evento → fail-closed (sin bitácora)");
}
{
  const { f, enviados } = fakeFetch({ attendees: [{ email: "nadir@gmail.com" }] });
  await escribirEvento("https://x/events/abc", "PATCH", {}, { description: BIT }, undefined, ctxT, f);
  check(enviados[0].description === BIT, "solo invitados internos → la bitácora se mantiene");
}
{
  const { f, enviados } = fakeFetch(null);
  await escribirEvento("https://x/events", "POST", {}, { description: BIT, attendees: [{ email: "cliente@mail.com" }] }, null, { internos: async () => new Set() }, f);
  check(enviados[0].description === DESCRIPCION_NEUTRA, "si falla la lista de cuentas, solo el dominio es interno");
}

{
  const urls: string[] = [];
  const prev = { summary: TITULO_NEUTRO, description: DESCRIPCION_NEUTRA, start: { dateTime: "2026-11-12T18:00:00-03:00" }, attendees: [{ email: "cliente@mail.com" }] };
  const f = (async (url: string, init?: any) => { if (init?.method) urls.push(url); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  await escribirEvento("https://x/events/abc?sendUpdates=all", "PATCH", {}, { summary: "Juan - hipertension", description: BIT }, prev, ctxT, f);
  check(urls[0].includes("sendUpdates=none"), "nota nueva en reunión con externo: no se le manda mail (cuerpo final igual)");
}

// mails a invitados: solo si cambia algo que les importa (no por cada nota)
const PV = { summary: "Reunión", start: { dateTime: "2026-11-12T18:00:00-03:00" }, end: { dateTime: "2026-11-12T19:00:00-03:00" }, attendees: [{ email: "c@x.com" }] };
check(!cambiaParaInvitados({ summary: "Reunión", description: "nota nueva", start: { dateTime: "2026-11-12T18:00:00" }, end: { dateTime: "2026-11-12T19:00:00" } }, PV), "nota nueva sola → no se manda mail");
check(cambiaParaInvitados({ start: { dateTime: "2026-11-12T19:00:00" } }, PV), "cambio de hora → se avisa");
check(cambiaParaInvitados({ attendees: [{ email: "c@x.com" }, { email: "d@x.com" }] }, PV), "invitado nuevo → se avisa");

// Guardia estática: ninguna escritura a Google por fuera de escribirEvento.
for (const f of ["../gcal-events/index.ts", "../gcal-events-admin/index.ts", "./tarea_evento.ts"]) {
  let src: string;
  try { src = await Deno.readTextFile(new URL(f, import.meta.url)); } catch { continue; } // la copia de este repo no la tiene
  const lines = src.split("\n");
  const malas = lines.map((l, i) => [l, i] as const).filter(([l, i]) => {
    if (!/method:\s*"(POST|PATCH|PUT)"\s*[,}]/.test(l)) return false;
    const ctx = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    return !/oauth2\.googleapis\.com\/token|\/move\?/.test(ctx); // token y move no llevan descripción
  });
  check(malas.length === 0, `sin escrituras a Google fuera de escribirEvento en ${f}${malas.length ? " (líneas " + malas.map(([, i]) => i + 1).join(",") + ")" : ""}`);
}

console.log(`\n${mal ? "X" : "✓"} tarea_evento: ${ok}/${ok + mal} OK`);
if (mal) Deno.exit(1);
