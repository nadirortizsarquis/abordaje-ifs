// Edge Function — Cambiar el email de un user (solo admin).
// Actualiza auth.users.email Y la columna duplicada en public.profiles.
// Guard anti-escalada: un admin NO puede cambiar el email de OTRO admin
// (solo el megaadmin puede). Sin esto, un admin secundario podía redirigir
// la cuenta del megaadmin a un email propio y tomar control.
import { requireAdmin, json } from './_shared/admin-auth.ts';

const MEGAADMIN_EMAIL = 'nortiz@ifs-broker.com';

Deno.serve(async req => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { caller, admin } = auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const userId = String(body.user_id ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!userId) return json({ error: 'user_id requerido' }, 400);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Email inválido' }, 400);
  }

  const callerIsMega = (caller.email || '').toLowerCase() === MEGAADMIN_EMAIL;
  if (!callerIsMega && userId !== caller.id) {
    const { data: target } = await admin
      .from('profiles').select('role').eq('id', userId).single();
    if (target?.role === 'admin') {
      return json({ error: 'Solo el megaadmin puede cambiar el email de otro admin' }, 403);
    }
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
