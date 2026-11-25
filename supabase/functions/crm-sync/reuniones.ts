// Reuniones de Meet grabadas (decisión de Nadir, 18/11/2026). En la Bitácora de la tarjeta
// queda una sola línea "[dd/mm/aa hh:mm · Reunión] Reunión #N — título" y el resumen completo
// vive en reunion_transcripciones (solapa Reuniones).
//
// Desde el 25/11/2026 el CRM tiene su propia sección Reuniones (antilic/ifs-broker-api#45):
// cada reunión aprobada viaja aparte (POST /clients/<id>/meetings/) y el CRM escribe solo la
// línea "Reunión #N — título" en su bitácora, con link a la reunión. Por eso esas líneas
// salen del bloque de la tarjeta (si no, quedarían dos veces). El CRM numera por cliente.
import type { Nota } from "./delta.ts";

export interface ReunionAprobada {
  id: string; numero: number; titulo: string | null; resumen: string | null;
  inicio: string | null; creado_at: string | null;
}

export interface ReunionEnvio {
  title: string; summary: string; held_at: string; source: "universo"; source_id: string;
  numero: number;
}

// La línea tiene que coincidir con número Y título de una reunión aprobada de ESTA tarjeta
// (mismo criterio que la solapa en TareaModal.jsx): una nota manual "Reunión #3 con el
// gerente", o una que vino de otra tarjeta al unificar, no se toca.
export const lineaDe = (r: Pick<ReunionAprobada, "numero" | "titulo">) => `Reunión #${r.numero} — ${(r.titulo || "").trim()}`;

// El CRM muestra el resumen como texto plano: sin ** ni __ ni # de títulos de Markdown.
export const sinMarkdown = (s: string) => s
  .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
  .replace(/^#{1,6}\s+/gm, "").trim();

// Separa de las notas de una tarjeta las líneas de reuniones aprobadas con resumen: esas
// van a la sección Reuniones del CRM. source_id lleva el cliente para que, si la tarjeta se
// re-vincula a otro cliente, la reunión se cree también ahí (el CRM es idempotente por
// source + source_id: un reintento no la duplica).
export function separarReuniones(
  notas: Nota[], reuniones: ReunionAprobada[] | undefined, clientId: number,
): { notas: Nota[]; reuniones: ReunionEnvio[] } {
  if (!reuniones?.length) return { notas, reuniones: [] };
  const porLinea = new Map(reuniones.map((r) => [lineaDe(r), r]));
  const quedan: Nota[] = [];
  const envio: ReunionEnvio[] = [];
  for (const n of notas) {
    const r = n.tipo === "reunion" ? porLinea.get(n.texto.trim()) : undefined;
    const resumen = sinMarkdown(r?.resumen || "");
    if (!r || !resumen) { quedan.push(n); continue; }
    envio.push({
      title: ((r.titulo || "").trim() || `Reunión #${r.numero}`).slice(0, 120),
      summary: resumen,
      held_at: r.inicio || r.creado_at || new Date().toISOString(),
      source: "universo",
      source_id: `${r.id}:${clientId}`,
      numero: r.numero,
    });
  }
  return { notas: quedan, reuniones: envio };
}
