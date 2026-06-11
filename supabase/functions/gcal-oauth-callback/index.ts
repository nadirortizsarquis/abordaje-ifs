// gcal-oauth-callback: Google nos llama acá después de que el user dio el
// consentimiento. Recibe ?code=... &state=... en query string.
// Valida el state firmado, intercambia el code por tokens, guarda el
// refresh_token en user_google_tokens, activa profiles.gcal_enabled y redirige
// al user de vuelta a Abordaje con ?gcal_linked=1.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REDIRECT_URI = "https://hxjpnekzncqepbhpdkfv.supabase.co/functions/v1/gcal-oauth-callback";
const MAX_STATE_AGE_SEC = 600; // 10 min máximo entre init y callback

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlDecodeStr(s: string): string {
  return new TextDecoder().decode(b64urlDecode(s));
}
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyState(state: string, secret: string): Promise<any | null> {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"],
  );
  const expected = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  if (b64url(new Uint8Array(expected)) !== sig) return null;
  try {
    const payload = JSON.parse(b64urlDecodeStr(body));
    const age = Math.floor(Date.now() / 1000) - (payload.t || 0);
    if (age > MAX_STATE_AGE_SEC) return null;
    return payload;
  } catch { return null; }
}

function errorRedirect(returnTo: string, msg: string): Response {
  const u = new URL(returnTo);
  u.searchParams.set("gcal_error", msg);
  return Response.redirect(u.toString(), 302);
}

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  const stateSecret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET")!;
  let payload: any = null;
  if (state) payload = await verifyState(state, stateSecret);
  const returnTo = payload?.r || "https://abordaje.broker-ifs.com";

  if (errParam) return errorRedirect(returnTo, errParam);
  if (!code || !payload) return errorRedirect(returnTo, "invalid_state");

  try {
    // Intercambiar code por tokens.
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResp.ok) {
      const txt = await tokenResp.text();
      console.error("token exchange failed:", tokenResp.status, txt);
      return errorRedirect(returnTo, "token_exchange_failed");
    }
    const tokens = await tokenResp.json();
    const refreshToken: string | undefined = tokens.refresh_token;
    const scope: string | undefined = tokens.scope;
    if (!refreshToken) {
      // Google a veces no devuelve refresh_token si el user ya consintió antes
      // y no usamos prompt=consent (lo usamos, pero por las dudas).
      return errorRedirect(returnTo, "no_refresh_token");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Upsert refresh token + scope
    await admin.from("user_google_tokens").upsert({
      user_id: payload.uid,
      refresh_token: refreshToken,
      scope: scope || null,
      granted_at: new Date().toISOString(),
    });
    // Activar gcal_enabled en el profile
    await admin.from("profiles").update({ gcal_enabled: true }).eq("id", payload.uid);

    const u = new URL(returnTo);
    u.searchParams.set("gcal_linked", "1");
    return Response.redirect(u.toString(), 302);
  } catch (err) {
    console.error("gcal-oauth-callback error:", err);
    return errorRedirect(returnTo, "server_error");
  }
});
