// Test de la línea de reunión + resumen que viaja al CRM (deno run reuniones_test.ts).
import { parseNotes } from "./delta.ts";
import { buildDescription } from "./format.ts";
import { conResumenes } from "./reuniones.ts";
const eq = (a: unknown, b: unknown, m: string) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${m}:\n  ${sa}\n  !== ${sb}`);
  console.log("ok ", m);
};

const notas = parseNotes("[18/11/26 10:30 · Reunión] Reunión #2 — Propuesta vida IT\n\n[17/11/26 09:00 · Llamado] Le dejé mensaje\n\n[16/11/26 08:00 · Reunión] Reunión #9 — sin resumen guardado");
const res = new Map([[2, "• Quiere vida con ahorro\n• Propuesta el viernes"]]);
const out = conResumenes(notas, res);
eq(out[0].texto, "#2 — Propuesta vida IT\n• Quiere vida con ahorro\n• Propuesta el viernes", "la línea de reunión lleva el resumen completo debajo");
eq(out[1], notas[1], "las notas que no son reunión no cambian");
eq(out[2].texto, "#9 — sin resumen guardado", "una reunión sin resumen guardado queda como línea sola");
eq(conResumenes(notas.slice(1, 2), undefined), notas.slice(1, 2), "una tarjeta sin reuniones no cambia");
eq(buildDescription([{ kind: "tarea", actualizacion: false, titulo: "Rebolini", notas: out.slice(0, 1) }], 2026),
  "UNIVERSO · Sinc. · Tarea Rebolini\n\n18/11  —  Reunión: #2 — Propuesta vida IT\n      • Quiere vida con ahorro\n      • Propuesta el viernes",
  "en el CRM: la línea y el resumen con sangría, en una sola nota");
