// gcal-oauth-init: el frontend llama acá para iniciar el flujo OAuth de Google
// y obtener un refresh_token de Calendar para el user actual (modo Fase 2,
// gmail externos al dominio Workspace).
// Devuelve { url } con la URL de OAuth de Google a la que el frontend redirige.
// El `state` es un JWT firmado con HMAC-SHA256 que incluye el user_id; la
// edge function callback lo valida cuando Google nos devuelve el code.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error } = await sb.auth.getUser(jwt);
    if (error || !user) return jsonResponse({ error: "unauthorized" }, 401);

    // returnTo: el frontend pasa la URL a la que volvemos después del callback
    // (típicamente la URL de Abordaje en producción o local). El callback
    // redirige ahí con ?gcal_linked=1 o ?gcal_error=...
    const body = await req.json().catch(() => ({}));
    const returnTo: string = body.returnTo || "https://abordaje.broker-ifs.com";

    const stateSecret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET")!;
    const state = await signState({
      uid: user.id,
      r: returnTo,
      t: Math.floor(Date.now() / 1000),
    }, stateSecret);

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar");
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
