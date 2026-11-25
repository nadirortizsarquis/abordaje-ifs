// Test de las reuniones grabadas que viajan a la sección Reuniones del CRM (deno run reuniones_test.ts).
import { parseNotes } from "./delta.ts";
import { separarReuniones, sinMarkdown } from "./reuniones.ts";
const eq = (a: unknown, b: unknown, m: string) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${m}:\n  ${sa}\n  !== ${sb}`);
  console.log("ok ", m);
};

const notas = parseNotes(
  "[18/11/26 10:30 · Reunión] Reunión #2 — Propuesta vida IT\n\n" +
  "[17/11/26 09:00 · Llamado] Le dejé mensaje\n\n" +
  "[16/11/26 08:00 · Reunión] Reunión #3 con el gerente\n\n" +
  "[15/11/26 08:00 · Reunión] Reunión #1 — Otro título (vino de otra tarjeta)\n\n" +
  "[14/11/26 08:00 · Reunión] Reunión #4 — Sin resumen");
const reus = [
  { id: "r2", numero: 2, titulo: "Propuesta vida IT", resumen: "- **Temas tratados:** vida con ahorro\n- **Próximos pasos:** propuesta el viernes", inicio: "2026-11-18T13:30:00Z", creado_at: "2026-11-18T13:00:00Z" },
  { id: "r1", numero: 1, titulo: "Primera charla", resumen: "• Algo", inicio: null, creado_at: "2026-11-10T12:00:00Z" },
  { id: "r4", numero: 4, titulo: "Sin resumen", resumen: "  ", inicio: null, creado_at: "2026-11-14T11:00:00Z" },
];
const out = separarReuniones(notas, reus, 77);
eq(out.reuniones, [{
  title: "Propuesta vida IT", summary: "- Temas tratados: vida con ahorro\n- Próximos pasos: propuesta el viernes",
  held_at: "2026-11-18T13:30:00Z", source: "universo", source_id: "r2:77", numero: 2,
}], "la reunión aprobada va a la sección Reuniones, sin Markdown y con el cliente en source_id");
eq(out.notas.map((n) => n.texto), [
  "Le dejé mensaje", "Reunión #3 con el gerente",
  "Reunión #1 — Otro título (vino de otra tarjeta)", "Reunión #4 — Sin resumen",
], "su línea sale del bloque; las demás notas (manuales, de otra tarjeta, sin resumen) quedan");
eq(separarReuniones(notas, undefined, 77), { notas, reuniones: [] }, "una tarjeta sin reuniones no cambia");
eq(separarReuniones(notas, reus, 78).reuniones[0].source_id, "r2:78", "re-vinculada a otro cliente: otro source_id");
eq(sinMarkdown("## Resumen\n- **a:** b __c__"), "Resumen\n- a: b c", "sinMarkdown saca negritas y títulos");
