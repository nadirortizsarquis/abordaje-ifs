// Edge Function — Cambiar el password de un user (solo admin).
// Guard anti-escalada: un admin NO puede cambiar el password de OTRO admin
// (solo el megaadmin puede). Sin esto, un admin secundario podía resetear
// la cuenta del megaadmin y tomar control.
import { requireAdmin, json } from './_shared/admin-auth.ts';

const MEGAADMIN_EMAIL = 'nortiz@ifs-broker.com';

Deno.serve(async req => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { caller, admin } = auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const userId = String(body.user_id ?? '');
  const password = String(body.password ?? '');
  if (!userId) return json({ error: 'user_id requerido' }, 400);
  if (!password || password.length < 8) {
    return json({ error: 'Password requerido (mínimo 8 caracteres)' }, 400);
  }

  const callerIsMega = (caller.email || '').toLowerCase() === MEGAADMIN_EMAIL;
  if (!callerIsMega && userId !== caller.id) {
    const { data: target } = await admin
      .from('profiles').select('role').eq('id', userId).single();
    if (target?.role === 'admin') {
      return json({ error: 'Solo el megaadmin puede cambiar el password de otro admin' }, 403);
    }
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, { password });
  if (updateErr) return json({ error: updateErr.message }, 500);

  return json({ ok: true }, 200);
});
