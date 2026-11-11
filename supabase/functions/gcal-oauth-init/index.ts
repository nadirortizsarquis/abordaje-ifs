// gcal-oauth-init: el frontend llama acá para iniciar el flujo OAuth de Google
// y obtener un refresh_token de Calendar para el user actual (modo Fase 2,
// gmail externos al dominio Workspace).
// Devuelve { url } con la URL de OAuth de Google a la que el frontend redirige.
// El `state` es un JWT firmado con HMAC-SHA256 que incluye el user_id; la
// edge function callback lo valida cuando Google nos devuelve el code.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { retornoSeguro } from "./retorno.js";

// Keys nuevas (sb_secret_/sb_publishable_) llegan como JSON en SUPABASE_SECRET_KEYS /
// SUPABASE_PUBLISHABLE_KEYS; fallback a las legacy mientras sigan activas (PM #111).
function envKey(jsonVar: string, legacyVar: string): string {
  try {
    // 'default' si existe; si no, la primera (la secret actual se llama 'rotationjarvis').
    const m = JSON.parse(Deno.env.get(jsonVar) ?? "");
    const k = m?.default ?? Object.values(m ?? {})[0];
    if (typeof k === "string" && k) return k;
  } catch { /* sin keys nuevas */ }
  console.warn(`envKey: usando legacy ${legacyVar}`);
  return Deno.env.get(legacyVar)!;
}
const SERVICE_KEY = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const REDIRECT_URI = "https://hxjpnekzncqepbhpdkfv.supabase.co/functions/v1/gcal-oauth-callback";

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signState(payload: object, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

function jsonResponse(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SERVICE_KEY,
      { auth: { persistSession: false } },
    );
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error } = await sb.auth.getUser(jwt);
    if (error || !user) return jsonResponse({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));

    // Paso 2 del flujo del Universo (M3): el navegador que volvió de Google confirma el
    // token pendiente. Solo se guarda si el usuario logueado ACÁ es el que inició el flujo:
    // un link de OAuth reenviado a otra persona no puede atar su Google a otra cuenta.
    if (body.confirmar) {
      const { data: pend } = await sb.from("gcal_oauth_pendientes").select("*").eq("id", String(body.confirmar)).maybeSingle();
      if (!pend) return jsonResponse({ error: "La conexión con Google venció. Probá conectar de nuevo." }, 400);
      const edadSeg = (Date.now() - new Date(pend.created_at).getTime()) / 1000;
      if (pend.user_id !== user.id || edadSeg > 900) {
        if (edadSeg > 900) await sb.from("gcal_oauth_pendientes").delete().eq("id", pend.id);
        return jsonResponse({ error: "Esta conexión con Google se inició con otra cuenta. Iniciá sesión con tu usuario y conectá de nuevo." }, 403);
      }
      const { error: e1 } = await sb.from("user_google_tokens").upsert({
        user_id: user.id, refresh_token: pend.refresh_token, scope: pend.scope, granted_at: new Date().toISOString(),
      });
      if (e1) return jsonResponse({ error: e1.message }, 500);
      await sb.from("profiles").update({ gcal_enabled: true }).eq("id", user.id);
      await sb.from("gcal_oauth_pendientes").delete().eq("id", pend.id);
      return jsonResponse({ ok: true });
    }

    // returnTo: a dónde volver después del callback. Solo dominios propios (M3).
    const returnTo: string = retornoSeguro(body.returnTo);

    const stateSecret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET")!;
    const state = await signState({
      uid: user.id,
      r: returnTo,
      t: Math.floor(Date.now() / 1000),
      // v=2: flujo con confirmación en el navegador (Universo). Sin v: flujo viejo de
      // Abordaje, que exige que el email de Google coincida con el de la cuenta.
      ...(body.confirmacion ? { v: 2 } : {}),
    }, stateSecret);

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/calendar");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent"); // fuerza refresh_token siempre
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);

    return jsonResponse({ url: url.toString() });
  } catch (err) {
    console.error("gcal-oauth-init error:", err);
    return jsonResponse({ error: String((err as any)?.message || err) }, 500);
  }
});
