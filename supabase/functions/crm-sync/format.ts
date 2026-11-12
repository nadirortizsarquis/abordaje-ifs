// Armado de la entrada de bitácora que va al CRM (texto plano + datos ordenados).
//
// El CRM muestra `description` como texto plano (pre-wrap), así que el orden y la
// forma son todo el diseño (aprobado por Nadir, 12/11/2026):
//
//   UNIVERSO · Sinc. · Tarea Laura Benítez
//   Ventas futuras · Olé · Recordatorio 01/10 09:00
//
//   12/11  —  Hito: Suscripción hecha.
//   11/11  —  Mañana vemos si encontramos un hueco.
//
// - "Sinc.": la fecha que muestra el CRM es la del sync, no la de cada nota.
// - Una nota por renglón, la más nueva arriba, sin hora; con año solo si no es el actual.
// - Actualizaciones: "Notas nuevas" en el título y, si la tarjeta cambió de columna,
//   "Anterior → Actual".
// `payload` lleva lo mismo estructurado para que el CRM pueda dibujarlo como
// tarjeta (PR pendiente al CRM); hoy el CRM lo ignora.
import { type Nota, TIPOS_NOTA } from "./delta.ts";

export interface ItemEnvio {
  kind: "tarea" | "contactos" | "agenda" | "contacto";
  actualizacion: boolean;
  titulo: string;                 // tarea / nombre del prospecto / "" (agenda)
  columna?: string;
  columnaAnterior?: string;       // solo si cambió desde el último sync
  compania?: string;
  recordatorio?: string;          // "01/10 09:00"
  notas: Nota[];                  // nuevas (o todas si es el primer envío)
  corregidas?: Nota[];
}

const SEP = "  —  ";

export function fmtNotaFecha(fechaIso: string | null, hoyYear: number): string {
  if (!fechaIso) return "";
  const [y, m, d] = fechaIso.split("-");
  return Number(y) === hoyYear ? `${d}/${m}` : `${d}/${m}/${y.slice(2)}`;
}

function lineaNota(n: Nota, hoyYear: number): string {
  const fecha = fmtNotaFecha(n.fecha, hoyYear);
  const tipo = n.tipo ? `${TIPOS_NOTA[n.tipo]}: ` : "";
  // Renglones siguientes con sangría (los vacíos, sin espacios colgando).
  const texto = n.texto.split("\n").map((l, i) => (i === 0 || !l.trim() ? l.trimEnd() : `      ${l.trim()}`)).join("\n");
  return fecha ? `${fecha}${SEP}${tipo}${texto}` : `·  ${tipo}${texto}`;
}

function encabezado(it: ItemEnvio): string {
  const que = it.kind === "tarea" ? `Tarea ${it.titulo || "(sin título)"}`
    : it.kind === "contactos" ? `Contactos · ${it.titulo}`
    : it.kind === "contacto" ? `Contacto ${it.titulo}`
    : `Agenda${it.titulo ? " " + it.titulo : ""}`;
  const l1 = ["UNIVERSO", "Sinc.", it.actualizacion ? "Notas nuevas" : "", que].filter(Boolean).join(" · ");
  const col = it.columnaAnterior && it.columna && it.columnaAnterior !== it.columna
    ? `${it.columnaAnterior} → ${it.columna}` : (it.columna || "");
  const l2 = [col, it.compania || "", it.recordatorio ? `Recordatorio ${it.recordatorio}` : ""].filter(Boolean).join(" · ");
  return l2 ? `${l1}\n${l2}` : l1;
}

export function buildDescription(items: ItemEnvio[], hoyYear: number): string {
  return items.map((it) => {
    const partes = [encabezado(it)];
    if (it.notas.length) partes.push(it.notas.map((n) => lineaNota(n, hoyYear)).join("\n"));
    if (it.corregidas?.length) {
      partes.push("Corregidas:\n" + it.corregidas.map((n) => lineaNota(n, hoyYear)).join("\n"));
    }
    return partes.join("\n\n");
  }).join("\n\n\n");
}

export function buildPayload(items: ItemEnvio[]) {
  const nota = (n: Nota, corregida: boolean) => ({
    fecha: n.fecha, hora: n.hora, tipo: n.tipo, texto: n.texto, corregida,
  });
  return {
    version: 1,
    origen: "universo",
    items: items.map((it) => ({
      tipo: it.kind,
      actualizacion: it.actualizacion,
      titulo: it.titulo || null,
      columna: it.columna || null,
      columna_anterior: it.columnaAnterior || null,
      compania: it.compania || null,
      recordatorio: it.recordatorio || null,
      notas: [...it.notas.map((n) => nota(n, false)), ...(it.corregidas ?? []).map((n) => nota(n, true))],
    })),
  };
}
