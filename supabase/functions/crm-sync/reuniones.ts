// Reuniones de Meet grabadas (decisión de Nadir, 18/11/2026). En la Bitácora de la tarjeta
// queda una sola línea "[dd/mm/aa hh:mm · Reunión] Reunión #N — título" y el resumen completo
// vive en reunion_transcripciones (solapa Reuniones). Hasta que el CRM tenga su propia
// sección de Reuniones, al CRM viajan juntas: la línea y, debajo, el resumen completo.
import type { Nota } from "./delta.ts";

export const NUM_REUNION = /^Reunión #(\d+)\b/;

// resumenes: número de reunión → resumen, de UNA tarjeta. En el CRM el tipo ya se lee
// ("Reunión: …"), así que la línea va como "#N — título" para no repetir la palabra.
export function conResumenes(notas: Nota[], resumenes: Map<number, string> | undefined): Nota[] {
  return notas.map((n) => {
    if (n.tipo !== "reunion") return n;
    const m = n.texto.match(NUM_REUNION);
    if (!m) return n;
    const linea = n.texto.replace(/^Reunión (#\d+)/, "$1");
    const r = resumenes?.get(Number(m[1]))?.trim();
    return { ...n, texto: r ? `${linea}\n${r}` : linea };
  });
}
