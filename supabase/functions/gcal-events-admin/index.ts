// gcal-events-admin v1 — variante service-role de gcal-events.
//
// MISMA lógica de negocio que gcal-events v11 (DWD para Workspace, refresh_token
// para externos, resolución de modo asistente vía profiles.assistant_of_id +
// shares_calendar_with_assistant). Único cambio: la identidad del CALLER no se
// resuelve via JWT del user — se pasa explícita en body.userId. Diseñada para
// que el MCP (abordaje-ifs-mcp, autenticado con service-role) opere sobre el
// calendar de cualquier user IFS sin necesitar JWT del frontend.
//
// SEGURIDAD: Authorization HEADER debe ser una secret key del proyecto (sb_secret_ o legacy service_role).
// Si no, 401. verify_jwt=false en la function — la auth la manejamos manualmente.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cargarTarea, crearEventoTarea, actualizarEventoTarea, borrarEnOtroCalendario, escribirEvento, internosPerezosos, hayExternos, blindarCuerpo } from "../_shared/tarea_evento.ts";

// Keys validas como credencial del caller: todas las secret nuevas (JSON
// SUPABASE_SECRET_KEYS) + la legacy service_role mientras siga activa (PM #111).
function serviceKeys(): string[] {
  const keys: string[] = [];
  try {
    const m = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "");
    for (const v of Object.values(m ?? {})) if (typeof v === "string" && v) keys.push(v);
  } catch { /* sin keys nuevas */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) keys.push(legacy);
  return keys;
}

const WORKSPACE_DOMAIN = "ifs-broker.com";
const DEFAULT_CALENDAR = "primary";

// Comparación en tiempo constante del token de service-role (evita timing attacks
// que infieran el secreto byte a byte). El chequeo de longitud filtra solo el
// largo (fijo y conocido), no el contenido.
function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id: string;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8", binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getDelegatedAccessToken(sa: ServiceAccountKey, impersonate: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id };
  const payload = {
    iss: sa.client_email, sub: impersonate,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  };
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const dataToSign = `${headerB64}.${payloadB64}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(dataToSign));
  const jwt = `${dataToSign}.${base64UrlEncode(new Uint8Array(sig))}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resp.ok) throw new Error(`token exchange failed: ${resp.status} ${await resp.text()}`);
  const { access_token } = await resp.json();
  return access_token;
}

async function getAccessTokenFromRefresh(refreshToken: string): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`refresh_token exchange failed: ${resp.status} ${txt}`);
  }
  const { access_token } = await resp.json();
  return access_token;
}

function jsonResponse(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }
  try {
    const validKeys = serviceKeys();
    const authHeader = req.headers.get("Authorization") || "";
    const presented = authHeader.replace(/^Bearer\s+/i, "");
    if (!presented || !validKeys.some((k) => timingSafeEqualStr(presented, k))) {
      return jsonResponse({ error: "unauthorized: requires service-role" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!, validKeys[0],
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const userId: string = body?.userId || "";
    if (!userId) return jsonResponse({ error: "missing userId in body" }, 400);

    const op: string = body?.op || "";
    if (!op) return jsonResponse({ error: "missing op" }, 400);

    const { data: callerProfile } = await supabase.from("profiles")
      .select("id, email, gcal_enabled, assistant_of_id, gcal_calendar_id")
      .eq("id", userId).maybeSingle();
    if (!callerProfile) return jsonResponse({ error: "caller profile not found" }, 404);

    let targetProfile: any = callerProfile;
    let targetUserId: string = callerProfile.id;
    let asAssistant = false;

    if (callerProfile?.assistant_of_id) {
      asAssistant = true;
      const { data: principal } = await supabase.from("profiles")
        .select("id, email, gcal_enabled, shares_calendar_with_assistant, gcal_calendar_id")
        .eq("id", callerProfile.assistant_of_id).maybeSingle();
      if (!principal) return jsonResponse({ skip: "principal not found" });
      if (!principal.shares_calendar_with_assistant) {
        return jsonResponse({ skip: "principal did not share calendar", asAssistant: true });
      }
      if (!principal.gcal_enabled) {
        return jsonResponse({ skip: "principal gcal not enabled", asAssistant: true });
      }
      targetProfile = principal;
      targetUserId = principal.id;
    }

    // Email REAL de auth.users, nunca profiles.email (sec-01, igual que gcal-events).
    const { data: authU } = await supabase.auth.admin.getUserById(targetUserId);
    const targetEmail = (authU?.user?.email || "").toLowerCase();
    if (!targetEmail) return jsonResponse({ error: "no email on target" }, 400);
    if (!targetProfile?.gcal_enabled) {
      return jsonResponse({ skip: "gcal not enabled", email: targetEmail });
    }

    const isWorkspace = targetEmail.endsWith("@" + WORKSPACE_DOMAIN);
    let accessToken: string;
    if (isWorkspace) {
      const saJson: ServiceAccountKey = JSON.parse(Deno.env.get("GOOGLE_SA_KEY")!);
      accessToken = await getDelegatedAccessToken(saJson, targetEmail);
    } else {
      const { data: tokenRow } = await supabase.from("user_google_tokens")
        .select("refresh_token").eq("user_id", targetUserId).maybeSingle();
      if (!tokenRow?.refresh_token) {
        return jsonResponse({
          error: asAssistant ? "principal not linked" : "not linked — needs OAuth",
          needsLink: true, asAssistant,
        }, 403);
      }
      try {
        accessToken = await getAccessTokenFromRefresh(tokenRow.refresh_token);
        await supabase.from("user_google_tokens")
          .update({ last_used_at: new Date().toISOString() })
          .eq("user_id", targetUserId);
      } catch (e) {
        const msg = String((e as any)?.message || e);
        if (msg.includes("invalid_grant") || msg.includes("400")) {
          await supabase.from("user_google_tokens").delete().eq("user_id", targetUserId);
          await supabase.from("profiles").update({ gcal_enabled: false }).eq("id", targetUserId);
          return jsonResponse({
            error: "refresh_token revoked — re-link needed",
            needsLink: true, asAssistant,
          }, 403);
        }
        throw e;
      }
    }

    // Calendario del agente (Ajustes) o el principal de su cuenta.
    const calendarId = body.calendarId || targetProfile?.gcal_calendar_id || DEFAULT_CALENDAR;
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const reqHeaders = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
    // Toda escritura a Google pasa por escribirEvento (blindaje de invitados externos).
    const ctx = { internos: internosPerezosos(supabase) };

    // blindar: control periódico del reconciliador del MCP. Si el evento tiene invitados
    // externos y su descripción no es la neutra (por ejemplo, alguien agregó un invitado
    // a mano en Google), se la neutraliza sin avisar por mail.
    if (op === "blindar") {
      const eid = String(body.eventId || "");
      if (!/^[A-Za-z0-9_-]{5,1024}$/.test(eid)) return jsonResponse({ error: "eventId inválido" }, 400);
      const gr = await fetch(`${base}/${encodeURIComponent(eid)}`, { headers: reqHeaders });
      if (gr.status === 404 || gr.status === 410) return jsonResponse({ ok: true, existe: false, externos: false, corregido: false });
      if (!gr.ok) throw new Error(`get failed: ${gr.status} ${await gr.text()}`);
      const ev = await gr.json();
      const externos = hayExternos(null, ev, await ctx.internos());
      const cuerpo = externos ? blindarCuerpo({}, true, true, ev) : null;
      const cambia = !!cuerpo && ((cuerpo.description !== undefined && cuerpo.description !== ev.description)
        || (cuerpo.summary !== undefined && cuerpo.summary !== ev.summary));
      if (!cambia) return jsonResponse({ ok: true, existe: true, externos, corregido: false });
      const r = await escribirEvento(`${base}/${encodeURIComponent(eid)}?sendUpdates=none`, "PATCH", reqHeaders, {}, ev, ctx);
      if (!r.ok) throw new Error(`blindar failed: ${r.status} ${await r.text()}`);
      console.warn(`blindaje: título/descripción neutralizados en evento ${eid} (invitados externos)`);
      return jsonResponse({ ok: true, existe: true, externos, corregido: true });
    }

    const decorate = (event: any) => {
      const prevExt = event?.extendedProperties || {};
      const prevPriv = prevExt.private || {};
      const priv = {
        ...prevPriv,
        abordaje_actor_id: callerProfile.id,
        abordaje_agente_id: targetUserId,
      };
      return { ...event, extendedProperties: { ...prevExt, private: priv } };
    };

    // list: eventos del calendario en un rango (lo usa reconciliar_calendar del MCP para
    // detectar duplicados). Rango acotado a 120 días; solo eventos vivos.
    if (op === "list") {
      const tMin = new Date(String(body.timeMin || "")), tMax = new Date(String(body.timeMax || ""));
      if (isNaN(+tMin) || isNaN(+tMax) || tMax <= tMin || (+tMax - +tMin) > 120 * 864e5) {
        return jsonResponse({ error: "timeMin/timeMax inválidos (máx. 120 días)" }, 400);
      }
      const items: any[] = [];
      let pageToken = "";
      for (let i = 0; i < 10; i++) {
        const u = new URL(base);
        u.searchParams.set("timeMin", tMin.toISOString());
        u.searchParams.set("timeMax", tMax.toISOString());
        u.searchParams.set("singleEvents", "true");
        u.searchParams.set("maxResults", "250");
        if (pageToken) u.searchParams.set("pageToken", pageToken);
        const r = await fetch(u.toString(), { headers: reqHeaders });
        if (!r.ok) throw new Error(`list failed: ${r.status} ${await r.text()}`);
        const j = await r.json();
        items.push(...(j.items || []).filter((e: any) => e.status !== "cancelled"));
        pageToken = j.nextPageToken || "";
        if (!pageToken) break;
      }
      return jsonResponse({ ok: true, events: items, asAssistant });
    }

    if (op === "create") {
      // Evento de una tarjeta: uno solo por tarjeta (ver _shared/tarea_evento.ts).
      const tarea = await cargarTarea(supabase, body.event, targetUserId);
      if (tarea) {
        const { event: evt, reutilizado } = await crearEventoTarea(base, reqHeaders, decorate(body.event), tarea, ctx);
        return jsonResponse({ ok: true, event: evt, reutilizado, asAssistant });
      }
      const r = await escribirEvento(base, "POST", reqHeaders, decorate(body.event), null, ctx, fetch, false);
      if (!r.ok) throw new Error(`create failed: ${r.status} ${await r.text()}`);
      return jsonResponse({ ok: true, event: await r.json(), asAssistant });
    }
    if (op === "update") {
      const tarea = await cargarTarea(supabase, body.event, targetUserId);
      if (tarea) {
        const evt = await actualizarEventoTarea(base, reqHeaders, body.eventId, decorate(body.event), tarea, ctx);
        return jsonResponse({ ok: true, event: evt, asAssistant });
      }
      const r = await escribirEvento(`${base}/${encodeURIComponent(String(body.eventId))}`, "PATCH", reqHeaders, decorate(body.event), undefined, ctx, fetch, false);
      if (!r.ok) throw new Error(`update failed: ${r.status} ${await r.text()}`);
      return jsonResponse({ ok: true, event: await r.json(), asAssistant });
    }
    if (op === "delete") {
      let isRecurringInstance = false;
      try {
        const getR = await fetch(`${base}/${body.eventId}`, { headers: reqHeaders });
        if (getR.ok) {
          const ev = await getR.json();
          isRecurringInstance = !!ev.recurringEventId;
        }
      } catch (_) { /* */ }
      if (isRecurringInstance) {
        const r = await escribirEvento(`${base}/${encodeURIComponent(String(body.eventId))}`, "PATCH", reqHeaders, { status: "cancelled" }, undefined, ctx, fetch, false);
        if (!r.ok && r.status !== 404 && r.status !== 410) {
          throw new Error(`cancel instance failed: ${r.status} ${await r.text()}`);
        }
        return jsonResponse({ ok: true, action: "instance_cancelled", asAssistant });
      }
      const r = await fetch(`${base}/${body.eventId}`, { method: "DELETE", headers: reqHeaders });
      if (!r.ok && r.status !== 404 && r.status !== 410) {
        throw new Error(`delete failed: ${r.status} ${await r.text()}`);
      }
      // No estaba en este calendario y el cliente no eligió uno: el agente cambió de
      // calendario en Ajustes y el evento quedó en el anterior → se borra allá.
      if ((r.status === 404 || r.status === 410) && !body.calendarId && body.eventId) {
        const borrado = await borrarEnOtroCalendario(base, reqHeaders, String(body.eventId));
        if (borrado) return jsonResponse({ ok: true, action: "deleted", otroCalendario: true, asAssistant });
      }
      return jsonResponse({ ok: true, action: "deleted", asAssistant });
    }

    return jsonResponse({ error: `unknown op: ${op}` }, 400);
  } catch (err) {
    console.error("gcal-events-admin error:", err);
    return jsonResponse({ error: String((err as any)?.message || err) }, 500);
  }
});
