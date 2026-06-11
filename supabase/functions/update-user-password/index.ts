// Edge Function — Cambiar el password de un user (solo admin).
import { requireAdmin, json } from './_shared/admin-auth.ts';

Deno.serve(async req => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const userId = String(body.user_id ?? '');
  const password = String(body.password ?? '');
  if (!userId) return json({ error: 'user_id requerido' }, 400);
  if (!password || password.length < 8) {
    return json({ error: 'Password requerido (mínimo 8 caracteres)' }, 400);
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, { password });
  if (updateErr) return json({ error: updateErr.message }, 500);

  return json({ ok: true }, 200);
});
