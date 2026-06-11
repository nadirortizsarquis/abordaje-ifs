// Helper compartido entre create-user, delete-user, update-user-password,
// update-user-email. Centraliza:
//   - Constantes de env (SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY)
//   - CORS headers
//   - json() para responses
//   - requireAdmin() valida JWT + role='admin' y devuelve clientes listos.
import { createClient } from 'jsr:@supabase/supabase-js@2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export async function requireAdmin(req: Request): Promise<
  | { ok: true; caller: { id: string; email: string | null }; admin: ReturnType<typeof createClient> }
  | { ok: false; response: Response }
> {
  if (req.method === 'OPTIONS') {
    return { ok: false, response: new Response('ok', { headers: CORS }) };
  }
  if (req.method !== 'POST') {
    return { ok: false, response: json({ error: 'Method not allowed' }, 405) };
  }
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { ok: false, response: json({ error: 'No autorizado' }, 401) };
  }
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !caller) {
    return { ok: false, response: json({ error: 'Sesión inválida' }, 401) };
  }
  const { data: prof } = await callerClient
    .from('profiles').select('role').eq('id', caller.id).single();
  if (prof?.role !== 'admin') {
    return { ok: false, response: json({ error: 'Solo admins' }, 403) };
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return { ok: true, caller: { id: caller.id, email: caller.email || null }, admin };
}
