// Test del armado de la bitácora para el CRM (deno run format_test.ts).
import { parseNote, parseNotes } from "./delta.ts";
import { buildDescription, buildPayload } from "./format.ts";
const eq = (a: unknown, b: unknown, m: string) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${m}:\n  ${sa}\n  !== ${sb}`);
  console.log("ok ", m);
};

const tarea = {
  kind: "tarea" as const, actualizacion: false, titulo: "Laura Benítez",
  columna: "Ventas futuras", compania: "Olé", recordatorio: "01/10 09:00",
  notas: parseNotes("[12/11/26 16:02 · Hito] Suscripción hecha.\n\n[18/08/26 09:04] le mandé mensaje\nsegunda línea\n\n[30/12/25] del año pasado\n\nsin fecha"),
};
eq(buildDescription([tarea], 2026),
  "UNIVERSO · Sinc. · Tarea Laura Benítez\nVentas futuras · Olé · Recordatorio 01/10 09:00\n\n" +
  "12/11  —  Hito: Suscripción hecha.\n18/08  —  le mandé mensaje\n      segunda línea\n30/12/25  —  del año pasado\n\n      sin fecha",
  "tarea nueva: encabezado, tipo, año solo si no es el actual, sangría");
eq(buildDescription([{ kind: "tarea", actualizacion: false, titulo: "X", notas: parseNotes("texto libre viejo") }], 2026),
  "UNIVERSO · Sinc. · Tarea X\n\n·  texto libre viejo", "texto libre sin marca");

eq(buildDescription([{ ...tarea, actualizacion: true, columnaAnterior: "Ventas futuras", columna: "Ventas pendientes", recordatorio: undefined,
  notas: [parseNote("[13/11/26 10:00] nueva")], corregidas: [parseNote("[12/11/26 16:02 · Hito] Suscripción hecha (corregido).")] }], 2026),
  "UNIVERSO · Sinc. · Notas nuevas · Tarea Laura Benítez\nVentas futuras → Ventas pendientes · Olé\n\n" +
  "13/11  —  nueva\n\nCorregidas:\n12/11  —  Hito: Suscripción hecha (corregido).",
  "actualización: título, flecha de columna y corregidas");

eq(buildDescription([{ ...tarea, actualizacion: true, columnaAnterior: "Ventas futuras", columna: "Ventas futuras", recordatorio: undefined, notas: [parseNote("[13/11/26 10:00] x")] }], 2026).split("\n")[1],
  "Ventas futuras · Olé", "misma columna: sin flecha");

eq(buildDescription([{ kind: "agenda", actualizacion: false, titulo: "", notas: [parseNote("[14/11/26 15:00] Meet con Laura")] },
  { kind: "contactos", actualizacion: false, titulo: "Juan Pérez", notas: [parseNote("[05/11/26 10:30] Contestador: volver a llamar")] }], 2026),
  "UNIVERSO · Sinc. · Agenda\n\n14/11  —  Meet con Laura\n\n\nUNIVERSO · Sinc. · Contactos · Juan Pérez\n\n05/11  —  Contestador: volver a llamar",
  "agenda y contactos, bloques separados");

const p = buildPayload([{ ...tarea, notas: [parseNote("[12/11/26 16:02 · Hito] ok")] }]);
eq(p.items[0].notas[0], { fecha: "2026-11-12", hora: "16:02", tipo: "hito", texto: "ok", corregida: false }, "payload: nota estructurada");
eq([p.version, p.origen, p.items[0].tipo, p.items[0].columna], [1, "universo", "tarea", "Ventas futuras"], "payload: cabecera");
console.log("format_test: todo ok");
