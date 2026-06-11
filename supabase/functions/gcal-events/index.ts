// gcal-events v11: soporta tanto users del dominio Workspace (via DWD/service
// account) como users externos (gmail personal) via OAuth user-level con el
// refresh_token guardado en user_google_tokens.
//
// v10 — Modo asistente: si el caller tiene profiles.assistant_of_id, la edge
// function opera sobre el calendar del PRINCIPAL (no el del asistente), siempre
// que el principal haya activado shares_calendar_with_assistant=true.
//
// v11 — Nuevo op="unlink": borra el refresh_token del user_google_tokens del
// caller y le baja profiles.gcal_enabled. Antes el frontend hacía
// sb.from('user_google_tokens').delete() directo, pero la tabla tiene RLS sin
// policies (por diseño, los secrets viven solo en service_role) entonces el
// delete fallaba silencioso y el refresh_token quedaba zombi. Ahora pasa por
// acá con service_role.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WORKSPACE_DOMAIN = "ifs-broker.com";
const DEFAULT_CALENDAR = "primary";

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

async function listCalendars(accessToken: string) {
  const r = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=true&minAccessRole=reader",
    { headers: { "Authorization": `Bearer ${accessToken}` } },
  );
  if (!r.ok) throw new Error(`calendarList failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return (data.items || []) as Array<any>;
}

async function listEventsOnCalendar(
  accessToken: string, calendarId: string, timeMin: string, timeMax: string,
) {
  const items: any[] = [];
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams({
      timeMin, timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { "Authorization": `Bearer ${accessToken}` } },
    );
    if (!r.ok) {
      console.warn(`events.list ${calendarId} failed: ${r.status}`);
      return items;
    }
    const data = await r.json();
    if (Array.isArray(data.items)) items.push(...data.items);
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return items;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !user) return jsonResponse({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const op: string = body?.op || "";

    // op=unlink: borra el refresh_token y baja gcal_enabled del CALLER.
    // Lo manejamos antes de resolver target/principal porque (a) opera sobre
    // el caller, (b) no requiere gcal_enabled=true, (c) no necesita
    // intercambiar tokens con Google (de hecho, está desvinculando).
    if (op === "unlink") {
      await supabase.from("user_google_tokens").delete().eq("user_id", user.id);
      await supabase.from("profiles").update({ gcal_enabled: false }).eq("id", user.id);
      return jsonResponse({ ok: true, action: "unlinked" });
    }

    // Cargamos el profile del CALLER. Si es asistente (assistant_of_id != null),
    // resolvemos el principal y operamos sobre su calendar siempre que haya
    // dado consentimiento via shares_calendar_with_assistant.
    const { data: callerProfile } = await supabase.from("profiles")
      .select("id, email, gcal_enabled, assistant_of_id")
      .eq("id", user.id).maybeSingle();

    let targetProfile: any = callerProfile;
    let targetUserId: string = user.id;
    let asAssistant = false;

    if (callerProfile?.assistant_of_id) {
      asAssistant = true;
      const { data: principal } = await supabase.from("profiles")
        .select("id, email, gcal_enabled, shares_calendar_with_assistant")
        .eq("id", callerProfile.assistant_of_id).maybeSingle();
      if (!principal) {
        return jsonResponse({ skip: "principal not found" });
      }
      if (!principal.shares_calendar_with_assistant) {
        return jsonResponse({
          skip: "principal did not share calendar with assistant",
          asAssistant: true,
        });
      }
      if (!principal.gcal_enabled) {
        return jsonResponse({
          skip: "principal gcal not enabled",
          asAssistant: true,
        });
      }
      targetProfile = principal;
      targetUserId = principal.id;
    }

    const targetEmail = (targetProfile?.email || (asAssistant ? "" : user.email) || "").toLowerCase();
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
          error: asAssistant
            ? "principal not linked — needs OAuth"
            : "not linked — needs OAuth",
          needsLink: true,
          asAssistant,
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
            needsLink: true,
            asAssistant,
          }, 403);
        }
        throw e;
      }
    }

    if (!op) return jsonResponse({ error: "missing op" }, 400);

    if (op === "list") {
      const calendars = await listCalendars(accessToken);
      const allEvents: any[] = [];
      const results = await Promise.all(calendars.map(async (cal) => {
        const items = await listEventsOnCalendar(accessToken, cal.id, body.timeMin, body.timeMax);
        for (const ev of items) {
          ev._gcalId = cal.id;
          ev._gcalSummary = cal.summary;
          ev._gcalColor = cal.backgroundColor || null;
          ev._gcalPrimary = !!cal.primary;
        }
        return items;
      }));
      for (const arr of results) allEvents.push(...arr);
      return jsonResponse({ ok: true, events: allEvents, asAssistant });
    }

    if (op === "listCalendars") {
      const calendars = await listCalendars(accessToken);
      return jsonResponse({ ok: true, calendars, asAssistant });
    }

    const calendarId = body.calendarId || DEFAULT_CALENDAR;
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    if (op === "create") {
      const r = await fetch(base, {
        method: "POST", headers, body: JSON.stringify(body.event),
      });
      if (!r.ok) throw new Error(`create failed: ${r.status} ${await r.text()}`);
      const evt = await r.json();
      return jsonResponse({ ok: true, event: evt, asAssistant });
    }
    if (op === "update") {
      const r = await fetch(`${base}/${body.eventId}`, {
        method: "PATCH", headers, body: JSON.stringify(body.event),
      });
      if (!r.ok) throw new Error(`update failed: ${r.status} ${await r.text()}`);
      const evt = await r.json();
      return jsonResponse({ ok: true, event: evt, asAssistant });
    }
    if (op === "delete") {
      let isRecurringInstance = false;
      try {
        const getR = await fetch(`${base}/${body.eventId}`, { headers });
        if (getR.ok) {
          const ev = await getR.json();
          isRecurringInstance = !!ev.recurringEventId;
        }
      } catch (_) { /* */ }
      if (isRecurringInstance) {
        const r = await fetch(`${base}/${body.eventId}`, {
          method: "PATCH", headers,
          body: JSON.stringify({ status: "cancelled" }),
        });
        if (!r.ok && r.status !== 404 && r.status !== 410) {
          throw new Error(`cancel instance failed: ${r.status} ${await r.text()}`);
        }
        return jsonResponse({ ok: true, action: "instance_cancelled", asAssistant });
      }
      const r = await fetch(`${base}/${body.eventId}`, { method: "DELETE", headers });
      if (!r.ok && r.status !== 404 && r.status !== 410) {
        throw new Error(`delete failed: ${r.status} ${await r.text()}`);
      }
      return jsonResponse({ ok: true, action: "deleted", asAssistant });
    }

    return jsonResponse({ error: `unknown op: ${op}` }, 400);
  } catch (err) {
    console.error("gcal-events error:", err);
    return jsonResponse({ error: String((err as any)?.message || err) }, 500);
  }
});
