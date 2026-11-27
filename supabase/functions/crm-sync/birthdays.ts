// Cumpleaños de clientes para la tarjeta del Inicio (decisión 27/11/2026).
// Fuente ÚNICA: date_of_birth del CRM (clientes individuales + miembros de grupos,
// ya deduplicados por el CRM: GET /clients/birthdays/). OLE no entra acá: solo
// completa fechas faltantes en el CRM (POST /clients/birthdays/backfill/).
//
// Scope: SIEMPRE se consulta con el advisor_email del caller (el CRM lo exige en
// llamadas de servicio y devuelve lo que ve ese asesor; email inexistente -> vacío).
// Sin email -> vacío sin consultar (fail-closed). `only_own=true` limita también a un
// admin a su cartera; solo un admin que pide `todos: true` ve la de toda la agencia.

export type Crm = (path: string, init?: RequestInit) => Promise<any>;

export const DIAS_MAX = 31;

export function birthdaysPath(
  o: { start?: unknown; days?: unknown; todos?: unknown; isAdmin: boolean; advisorEmail: string },
): string | null {
  const params = new URLSearchParams();
  const start = String(o.start ?? "").trim();
  if (start) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw Object.assign(new Error("start inválido (AAAA-MM-DD)"), { status: 400 });
    params.set("start", start);
  }
  const n = Math.trunc(Number(o.days ?? 7));
  params.set("days", String(Number.isFinite(n) ? Math.min(DIAS_MAX, Math.max(1, n)) : 7));
  if (!o.advisorEmail) return null; // fail-closed
  params.set("advisor_email", o.advisorEmail);
  if (!(o.isAdmin && o.todos === true)) params.set("only_own", "true");
  return `/clients/birthdays/?${params.toString()}`;
}

// Solo lo que la tarjeta muestra (sin email ni DNI).
export function mapBirthday(r: any) {
  const a = r?.primary_advisor;
  return {
    kind: r?.kind === "member" ? "member" : "client",
    client_id: r?.client_id ?? null,
    member_id: r?.member_id ?? null,
    nombre: String(r?.full_name ?? ""),
    grupo: String(r?.group_name ?? ""),
    cumple: String(r?.birthday ?? ""),
    edad: typeof r?.age === "number" ? r.age : null,
    en_dias: typeof r?.days_until === "number" ? r.days_until : null,
    telefono: String(r?.phone ?? ""),
    asesor: a ? `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() : "",
  };
}

export async function birthdays(
  crm: Crm,
  o: { start?: unknown; days?: unknown; todos?: unknown; isAdmin: boolean; advisorEmail: string },
) {
  const path = birthdaysPath(o);
  if (!path) return { ok: true, items: [], scoped: true };
  const r = await crm(path);
  const items = (Array.isArray(r?.results) ? r.results : []).map(mapBirthday);
  return { ok: true, items, scoped: !(o.isAdmin && o.todos === true) };
}
