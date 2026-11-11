// ── Propiedad de un cliente del CRM (SEGURIDAD, nov 2026) ───────────────────
// El token de servicio (CRM_API_TOKEN) ve TODO el CRM. Para un no-admin, antes de
// vincular o volcar gestión a un cliente, verificamos que ese cliente sea SUYO:
// la API de Bruno solo scopea por asesor en el LISTADO (`advisor_email`), así que
// leemos el detalle con el bot y buscamos ese mismo id en el listado scopeado
// (por documento exacto o, sin documento, por nombre). Fail-closed: si no se
// puede confirmar, NO es suyo. Sin esto, un asesor podía anclar su prospecto al
// id de un cliente ajeno (o setear crm_client_id directo en su fila) y escribir
// en la bitácora de otro asesor.
type CrmFn = (path: string, init?: RequestInit) => Promise<any>;
export async function clienteEsDelAsesor(crm: CrmFn, clientId: number, advisorEmail: string): Promise<boolean> {
  if (!advisorEmail || !clientId) return false;
  let det: any;
  try { det = await crm(`/clients/${clientId}/`); } catch (e) {
    if ((e as any)?.status === 404) return false;
    throw e; // CRM caído: lo maneja el caller (no vincular / no volcar)
  }
  const scope = `advisor_email=${encodeURIComponent(advisorEmail)}`;
  const doc = String(det?.document_number ?? "").trim();
  const nombre = String(det?.full_name ?? "").trim();
  const consultas = [
    doc ? `/clients/?document_number=${encodeURIComponent(doc)}&${scope}` : "",
    nombre ? `/clients/?search=${encodeURIComponent(nombre)}&${scope}` : "",
  ].filter(Boolean);
  for (const base of consultas) {
    for (let page = 1; page <= 3; page++) {
      const r = await crm(`${base}&page=${page}`).catch((e: any) => {
        if (e?.status === 404) return null; // página inexistente
        throw e;
      });
      const results: any[] = r?.results ?? [];
      if (results.some((c) => Number(c?.id) === Number(clientId))) return true;
      if (!r?.next) break;
    }
  }
  return false;
}

// ── Prospecto canónico de un ítem (tarea/agendado) ──────────────────────────
// Solo se toma el prospecto como ancla si es del MISMO dueño que el ítem. La base
// ya lo garantiza (trigger private.check_prospecto_mismo_agente, migración
// 20261111113446); esto es defensa en profundidad por si un prospecto se reasigna
// a otro agente después de creado el ítem. Ítem con prospecto ajeno -> se trata
// como suelto (no se lee ni se escribe el prospecto de otro).
export function prospectoDelItem<P extends { agente_id?: string | null }>(
  item: { agente_id?: string | null },
  prospecto: P | null | undefined,
): P | null {
  if (!prospecto || !item?.agente_id) return null;
  return prospecto.agente_id === item.agente_id ? prospecto : null;
}

// `force:true` en op=create saltea el chequeo de DNI duplicado. Solo admin.
export function puedeForzarCreate(force: unknown, isAdmin: boolean): boolean {
  return force === true && isAdmin === true;
}

// Tareas/agendas con crm_client_id: se vuelcan SOLO si no cuelgan de un prospecto
// ya vinculado al mismo cliente (ese prospecto vuelca sus contactos, que son el
// registro canónico) -> evita la misma gestión dos veces en la bitácora CRM.
export function soloSueltas<R extends { prospecto_id?: string | null }>(rows: R[], prospIds: string[]): R[] {
  const set = new Set(prospIds);
  return rows.filter((r) => !r.prospecto_id || !set.has(r.prospecto_id));
}
