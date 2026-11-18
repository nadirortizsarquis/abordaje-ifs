// Reuniones de Meet grabadas (decisión de Nadir, 18/11/2026). En la Bitácora de la tarjeta
// queda una sola línea "[dd/mm/aa hh:mm · Reunión] Reunión #N — título" y el resumen completo
// vive en reunion_transcripciones (solapa Reuniones). Hasta que el CRM tenga su propia
// sección de Reuniones, al CRM viajan juntas: la línea y, debajo, el resumen completo.
import type { Nota } from "./delta.ts";

export interface ReunionAprobada { numero: number; titulo: string | null; resumen: string | null }

// La línea tiene que coincidir con número Y título de una reunión aprobada de ESTA tarjeta
// (mismo criterio que la solapa en TareaModal.jsx): una nota manual "Reunión #3 con el
// gerente", o una que vino de otra tarjeta al unificar, no se toca.
export const lineaDe = (r: ReunionAprobada) => `Reunión #${r.numero} — ${(r.titulo || "").trim()}`;

// En el CRM el tipo ya se lee ("Reunión: …"), así que va como "#N — título" + el resumen.
export function conResumenes(notas: Nota[], reuniones: ReunionAprobada[] | undefined): Nota[] {
  if (!reuniones?.length) return notas;
  const porLinea = new Map(reuniones.map((r) => [lineaDe(r), r]));
  return notas.map((n) => {
    if (n.tipo !== "reunion") return n;
    const r = porLinea.get(n.texto.trim());
    if (!r) return n;
    const resumen = (r.resumen || "").trim();
    const linea = n.texto.trim().replace(/^Reunión (#\d+)/, "$1");
    return { ...n, texto: resumen ? `${linea}\n${resumen}` : linea };
  });
}
