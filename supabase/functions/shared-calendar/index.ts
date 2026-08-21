// shared-calendar — Calendario compartido (Abordaje).
//
// Devuelve, ANONIMIZADO, los espacios OCUPADO de otros agentes que autorizaron
// al caller. NUNCA devuelve título/asunto/datos: solo intervalos { ownerId,
// start, end }. El caller solo ve owners donde: share(owner->caller) existe Y
// owner.compartir_calendario Y caller.compartir_calendario (server-side).
//
// Qué cuenta como OCUPADO (regla de Nadid):
//   - Eventos REALES de Google Calendar del owner que NO fueron creados por
//     Abordaje (sin extendedProperties.private.abordaje_*). = reuniones externas.
//   - Agendas de Abordaje que son citas reales: abordaje_agendados (agenda directa
//     en el calendario) + abordaje_prospecto_contactos con tipo='agendado'.
//   NO cuenta: recordatorios de tarea ni de llamado (los violetas) — se excluyen
//   porque los eventos Abordaje-tagged de Google se descartan y del lado DB solo
//   tomamos los 'agendado'.
//
// Ops:
//   owners  -> [{ id, name }] de los owners que el caller puede ver (DB, sin Google).
//   busy    { timeMin, timeMax, ownerIds? } -> [{ ownerId, start, end }] anonimizado.
//
// Impersonación (igual que gcal-events): owners @ifs-broker.com via Domain-Wide
// Delegation (service account); gmail externos via su refresh_token guardado.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WORKSPACE_DOMAIN = "ifs-broker.com";
const DEFAULT_DUR_MIN = 60; // duración por defecto de una agenda sin fin explícito

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Impersonación Google (idéntico a gcal-events) ────────────────────────────
interface ServiceAccountKey { client_email: string; private_key: string; private_key_id: string; }
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const binary = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", binary, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getDelegatedAccessToken(sa: ServiceAccountKey, impersonate: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id };
  const payload = { iss: sa.client_email, sub: impersonate, scope: "https://www.googleapis.com/auth/calendar", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const dataToSign = `${headerB64}.${payloadB64}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(dataToSign));
  const jwt = `${dataToSign}.${base64UrlEncode(new Uint8Array(sig))}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!resp.ok) throw new Error(`token exchange failed: ${resp.status}`);
  const { access_token } = await resp.json();
  return access_token;
}
async function getAccessTokenFromRefresh(refreshToken: string): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error(`refresh exchange failed: ${resp.status}`);
  const { access_token } = await resp.json();
  return access_token;
}

// Token de acceso para el calendario de un OWNER (no del caller).
async function accessTokenForOwner(supabase: any, owner: { id: string; email: string }): Promise<string | null> {
  const email = (owner.email || "").toLowerCase();
  if (email.endsWith("@" + WORKSPACE_DOMAIN)) {
    const saJson: ServiceAccountKey = JSON.parse(Deno.env.get("GOOGLE_SA_KEY")!);
    return await getDelegatedAccessToken(saJson, email);
  }
  const { data: tokenRow } = await supabase.from("user_google_tokens").select("refresh_token").eq("user_id", owner.id).maybeSingle();
  if (!tokenRow?.refresh_token) return null; // gmail externo sin OAuth conectado -> no se puede leer
  try { return await getAccessTokenFromRefresh(tokenRow.refresh_token); } catch { return null; }
}

async function listCalendars(accessToken: string): Promise<any[]> {
  const r = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false&minAccessRole=reader",
    { headers: { "Authorization": `Bearer ${accessToken}` } });
  if (!r.ok) return [];
  const data = await r.json();
  return (data.items || []) as any[];
}
async function listEvents(accessToken: string, calendarId: string, timeMin: string, timeMax: string): Promise<any[]> {
  const items: any[] = []; let pageToken: string | null = null;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { "Authorization": `Bearer ${accessToken}` } });
    if (!r.ok) return items;
    const data = await r.json();
    if (Array.isArray(data.items)) items.push(...data.items);
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return items;
}

// ── Owners que el caller (viewer) puede ver ──────────────────────────────────
async function authorizedOwners(supabase: any, viewerId: string): Promise<Array<{ id: string; email: string; name: string }>> {
  const { data: shares } = await supabase.from("abordaje_calendar_shares").select("owner_id").eq("viewer_id", viewerId);
  const ownerIds = [...new Set((shares ?? []).map((s: any) => s.owner_id))];
  if (!ownerIds.length) return [];
  const { data: profs } = await supabase.from("profiles")
    .select("id, email, display_name, compartir_calendario").in("id", ownerIds);
  return (profs ?? [])
    .filter((p: any) => p.compartir_calendario) // el owner también tiene que participar
    .map((p: any) => ({ id: p.id, email: p.email || "", name: p.display_name || p.email || "Agente" }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !user) return jsonResponse({ error: "unauthorized" }, 401);

    // El caller tiene que tener el consentimiento ON para usar la feature.
    const { data: me } = await supabase.from("profiles").select("compartir_calendario").eq("id", user.id).maybeSingle();
    if (!me?.compartir_calendario) return jsonResponse({ error: "Calendario compartido no habilitado para tu usuario.", disabled: true }, 403);

    const body = await req.json().catch(() => ({}));
    const op: string = body?.op || "";

    const owners = await authorizedOwners(supabase, user.id);

    if (op === "owners") {
      return jsonResponse({ ok: true, owners: owners.map((o) => ({ id: o.id, name: o.name })) });
    }

    if (op === "busy") {
      const timeMin: string = body?.timeMin || "";
      const timeMax: string = body?.timeMax || "";
      if (!timeMin || !timeMax) return jsonResponse({ error: "missing timeMin/timeMax" }, 400);
      const filterIds: string[] | null = Array.isArray(body?.ownerIds) && body.ownerIds.length ? body.ownerIds : null;
      const targets = filterIds ? owners.filter((o) => filterIds.includes(o.id)) : owners;

      const blocks: Array<{ ownerId: string; start: string; end: string }> = [];
      const noAccess: string[] = [];

      await Promise.all(targets.map(async (owner) => {
        // 1) Citas reales de la DB (agendas directas + prospecto tipo 'agendado').
        try {
          const { data: ags } = await supabase.from("abordaje_agendados")
            .select("fecha").eq("agente_id", owner.id).gte("fecha", timeMin).lte("fecha", timeMax);
          for (const a of ags ?? []) {
            const s = new Date(a.fecha);
            const e = new Date(s.getTime() + DEFAULT_DUR_MIN * 60000);
            blocks.push({ ownerId: owner.id, start: s.toISOString(), end: e.toISOString() });
          }
          const { data: cts } = await supabase.from("abordaje_prospecto_contactos")
            .select("fecha, hora").eq("agente_id", owner.id).eq("tipo", "agendado")
            .gte("fecha", timeMin.slice(0, 10)).lte("fecha", timeMax.slice(0, 10));
          for (const c of cts ?? []) {
            if (!c.fecha) continue;
            const hhmm = (c.hora || "09:00").slice(0, 5);
            const s = new Date(`${c.fecha}T${hhmm}:00`);
            if (isNaN(s.getTime())) continue;
            const e = new Date(s.getTime() + DEFAULT_DUR_MIN * 60000);
            blocks.push({ ownerId: owner.id, start: s.toISOString(), end: e.toISOString() });
          }
        } catch (_) { /* DB best-effort */ }

        // 2) Reuniones externas de Google (sin tag Abordaje).
        const token = await accessTokenForOwner(supabase, owner);
        if (!token) { noAccess.push(owner.id); return; }
        try {
          const cals = await listCalendars(token);
          const calIds = cals.length ? cals.map((c) => c.id) : ["primary"];
          for (const calId of calIds) {
            const evs = await listEvents(token, calId, timeMin, timeMax);
            for (const ev of evs) {
              if (ev.status === "cancelled") continue;
              const ext = ev.extendedProperties?.private || {};
              // Descartar TODO lo creado por Abordaje (tareas, prospecto, agendas):
              // esas citas ya vienen (o no) de la DB según la regla.
              if (ext.abordaje_tarea_id || ext.abordaje_prospect_id || ext.abordaje_agente_id) continue;
              if (ev.transparency === "transparent") continue; // marcado "disponible" en Google
              const start = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00` : null);
              const end = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00` : null);
              if (!start || !end) continue;
              blocks.push({ ownerId: owner.id, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
            }
          }
        } catch (_) { noAccess.push(owner.id); }
      }));

      return jsonResponse({ ok: true, blocks, noAccess });
    }

    return jsonResponse({ error: `unknown op: ${op}` }, 400);
  } catch (err) {
    console.error("shared-calendar error:", err);
    return jsonResponse({ error: String((err as any)?.message || err) }, 500);
  }
});
