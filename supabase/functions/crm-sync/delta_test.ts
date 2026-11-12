// Test del delta de notas (deno run delta_test.ts).
import { noteKeys, notesDelta, parseNote, splitNotes } from "./delta.ts";
const eq = (a: unknown, b: unknown, m: string) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${m}:\n  ${sa}\n  !== ${sb}`);
  console.log("ok ", m);
};
const viejo = "[18/08/26 09:04] le mandé mensaje\n\n[04/08/26 16:50] vemos mañana";
const sent = noteKeys(viejo);

eq(splitNotes("[11/11/26 09:38] a\n[05/11/26 15:23] b\nsigue b\n\n[13/10/26] c"),
  ["[11/11/26 09:38] a", "[05/11/26 15:23] b\nsigue b", "[13/10/26] c"], "split: bloques pegados, multilínea y sin hora");
eq(splitNotes("texto libre\nsin fechas"), ["texto libre\nsin fechas"], "split: texto libre = un bloque");
eq(splitNotes("ver [12/11/26 10:00] en el medio"), ["ver [12/11/26 10:00] en el medio"], "split: fecha en medio de línea no corta");

eq(notesDelta(sent, viejo), null, "sin cambios -> nada");
eq(notesDelta(sent, viejo.replace("\n\n", "\n\n\n  ")), null, "solo espacios -> nada");
eq(notesDelta(sent, ""), null, "todo borrado -> nada");
eq(notesDelta(sent, "[18/08/26 09:04] le mandé mensaje"), null, "borrar UNA nota -> nada");
eq(notesDelta(sent, "[04/08/26 16:50] vemos mañana\n\n[18/08/26 09:04] le mandé mensaje"), null, "reordenar (unificar) -> nada");
eq(notesDelta(sent, "[12/11/26 16:02] Suscripción hecha.\n\n" + viejo),
  { nuevas: ["[12/11/26 16:02] Suscripción hecha."], editadas: [] }, "nota arriba -> solo la nueva");
eq(notesDelta(sent, "[12/11/26 16:02] x\n[11/11/26 09:00] y\n\n" + viejo),
  { nuevas: ["[12/11/26 16:02] x", "[11/11/26 09:00] y"], editadas: [] }, "dos nuevas pegadas -> ambas");
eq(notesDelta(sent, "[18/08/26 09:04] le mandé mensaje (corregido)\n\n[04/08/26 16:50] vemos mañana"),
  { nuevas: [], editadas: ["[18/08/26 09:04] le mandé mensaje (corregido)"] }, "corregir una vieja -> solo esa, editada");
eq(notesDelta(noteKeys("llamar"), "No volver a llamar más"),
  { nuevas: [], editadas: ["No volver a llamar más"] }, "texto libre reescrito -> editada completa (sin pedazos)");
eq(notesDelta(noteKeys("[18/08/26 09:04] A"), "[20/08/26 10:00] B"),
  { nuevas: ["[20/08/26 10:00] B"], editadas: [] }, "vaciar y escribir otra -> nueva");
eq(notesDelta([], "primera"), { nuevas: ["primera"], editadas: [] }, "sin enviado previo -> nueva");
eq(notesDelta(null, "[01/01/26] x"), { nuevas: ["[01/01/26] x"], editadas: [] }, "null previo -> nueva");
// Tipo dentro de la marca
eq(splitNotes("[12/11/26 16:02 · Hito] firmó\n[11/11/26 09:00] x"), ["[12/11/26 16:02 · Hito] firmó", "[11/11/26 09:00] x"], "split: marca con tipo");
eq(parseNote("[12/11/26 16:02 · Hito] Suscripción hecha."),
  { raw: "[12/11/26 16:02 · Hito] Suscripción hecha.", fecha: "2026-11-12", hora: "16:02", tipo: "hito", texto: "Suscripción hecha." }, "parse: con tipo");
eq(parseNote("[05/11/26 · Reunión] meet").tipo, "reunion", "parse: tipo con tilde, sin hora");
eq(parseNote("[05/11/26 10:00 · Otra cosa] x").tipo, null, "parse: tipo desconocido -> null");
eq(parseNote("texto libre").fecha, null, "parse: sin marca");
eq(notesDelta(noteKeys("[12/11/26 16:02] firmó"), "[12/11/26 16:02 · Hito] firmó"),
  { nuevas: [], editadas: ["[12/11/26 16:02 · Hito] firmó"] }, "agregar tipo a una enviada -> corregida");
eq(notesDelta(noteKeys("[12/11/26 16:02 · Hito] firmó"), "[13/11/26 09:00 · Llamado] x\n\n[12/11/26 16:02 · Hito] firmó"),
  { nuevas: ["[13/11/26 09:00 · Llamado] x"], editadas: [] }, "nueva con tipo -> nueva");
console.log("delta_test: todo ok");
