// Notas de la bitácora: parseo y delta para re-volcar al CRM lo nuevo.
//
// Formato (Universo, Abordaje y el MCP): bloques que arrancan con una marca
//   [dd/mm/aa hh:mm]            nota común
//   [dd/mm/aa hh:mm · Hito]     nota con tipo (Llamado, Mensaje, Reunión, Propuesta, Hito)
//   [dd/mm/aa]                  sin hora (notas viejas)
// el más nuevo arriba. Texto sin marca = un bloque libre.
//
// Delta NOTA POR NOTA: cada ítem guarda en crm_synced_blocks las claves (texto
// normalizado) de las notas que ya llegaron al CRM. Así:
//   - agregar notas            -> se mandan solo esas
//   - borrar / reordenar notas -> no se manda nada (unificar_tareas, limpiezas)
//   - corregir una nota vieja  -> se manda esa sola, como "corregida"
//     (misma fecha y hora que una enviada; cambiarle el tipo también cuenta)
// IMPORTANTE: noteKeys tiene que dar lo mismo que la función SQL
// abordaje_note_keys (migración crm_bitacora_v2). Mantener las regex alineadas.

const MARK = String.raw`\[\d{2}\/\d{2}\/\d{2}(?: \d{2}:\d{2})?(?: · [^\]\n]{1,24})?\]`;
const MARKER = new RegExp("^" + MARK);
const MARKER_LINE = new RegExp(String.raw`^[ \t]*(?=` + MARK + ")", "m");
const MARKER_PARTS = /^\[(\d{2})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}))?(?: · ([^\]\n]{1,24}))?\]\s*/;

export const TIPOS_NOTA: Record<string, string> = {
  llamado: "Llamado",
  mensaje: "Mensaje",
  reunion: "Reunión",
  propuesta: "Propuesta",
  hito: "Hito",
};
const TIPO_POR_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(TIPOS_NOTA).map(([k, v]) => [v.toLowerCase(), k]),
);

export interface Nota {
  raw: string;            // bloque tal cual (trim)
  fecha: string | null;   // ISO yyyy-mm-dd
  hora: string | null;    // hh:mm
  tipo: string | null;    // clave de TIPOS_NOTA (o null)
  texto: string;          // sin la marca
}

export function splitNotes(text: string | null | undefined): string[] {
  return (text ?? "").split(MARKER_LINE).map((b) => b.trim()).filter(Boolean);
}

export function parseNote(block: string): Nota {
  const raw = block.trim();
  const m = raw.match(MARKER_PARTS);
  if (!m) return { raw, fecha: null, hora: null, tipo: null, texto: raw };
  const [, dd, mm, yy, hh, mi, tipoTxt] = m;
  const tipo = tipoTxt ? (TIPO_POR_LABEL[tipoTxt.trim().toLowerCase()] ?? null) : null;
  return {
    raw,
    fecha: `20${yy}-${mm}-${dd}`,
    hora: hh ? `${hh}:${mi}` : null,
    tipo,
    texto: raw.slice(m[0].length).trim(),
  };
}

export function parseNotes(text: string | null | undefined): Nota[] {
  return splitNotes(text).map(parseNote);
}

export function noteKey(block: string): string {
  return block.replace(/\s+/g, " ").trim();
}

export function noteKeys(text: string | null | undefined): string[] {
  return [...new Set(splitNotes(text).map(noteKey))];
}

// Identidad de una nota para detectar correcciones: fecha+hora de la marca
// (sin el tipo). Texto libre sin marca: "".
function momento(keyOrBlock: string): string {
  const m = keyOrBlock.match(MARKER_PARTS);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4] ?? ""}:${m[5] ?? ""}` : "";
}

export type NotesDelta = { nuevas: string[]; editadas: string[] };

export function notesDelta(sent: string[] | null | undefined, cur: string | null | undefined): NotesDelta | null {
  const sentSet = new Set(sent ?? []);
  const sentMomentos = new Set([...sentSet].map(momento));
  const nuevas: string[] = [];
  const editadas: string[] = [];
  for (const b of splitNotes(cur)) {
    if (sentSet.has(noteKey(b))) continue;
    (sentMomentos.has(momento(b)) ? editadas : nuevas).push(b);
  }
  return nuevas.length || editadas.length ? { nuevas, editadas } : null;
}
