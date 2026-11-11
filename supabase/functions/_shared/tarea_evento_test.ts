// deno run tarea_evento_test.ts — lógica pura de "un evento por tarjeta".
import { aplicarTarea, COLOR_RECORDATORIO, idEventoDeTarea, sendUpdatesPara, tareaIdDelEvento, type TareaEvento } from "./tarea_evento.ts";

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

console.log(`\n${mal ? "X" : "✓"} tarea_evento: ${ok}/${ok + mal} OK`);
if (mal) Deno.exit(1);
