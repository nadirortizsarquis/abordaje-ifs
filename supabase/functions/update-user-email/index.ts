// Edge Function — Cambiar el email de un user (solo admin).
// Actualiza auth.users.email Y la columna duplicada en public.profiles.
import { requireAdmin, json } from './_shared/admin-auth.ts';

Deno.serve(async req => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const userId = String(body.user_id ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!userId) return json({ error: 'user_id requerido' }, 400);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Email inválido' }, 400);
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  });
  if (authErr) return json({ error: authErr.message }, 400);

  const { error: profErr } = await admin
    .from('profiles')
    .update({ email })
    .eq('id', userId);
  if (profErr) {
    return json({ error: 'Email cambiado en auth pero falló profile: ' + profErr.message }, 500);
  }

  return json({ ok: true, email }, 200);
});
