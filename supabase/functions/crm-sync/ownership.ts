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
