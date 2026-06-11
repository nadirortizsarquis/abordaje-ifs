// Edge Function — Borrar un user (solo el megaadmin Nadir).
//
// Borra el user de auth.users; gracias a las FK ON DELETE CASCADE,
// se borran automáticamente su row en public.profiles y todas sus
// filas en comisiones.* y abordaje_* (todas las apps IFS).
//
// Aunque profiles.role permita 'admin' a varios usuarios, el delete
// queda restringido al megaadmin (Nadir) para evitar borrados
// accidentales o conflictos entre admins.
import { requireAdmin, json } from './_shared/admin-auth.ts';

const MEGAADMIN_EMAIL = 'nortiz@ifs-broker.com';

Deno.serve(async req => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { caller, admin } = auth;

  if ((caller.email || '').toLowerCase() !== MEGAADMIN_EMAIL) {
    return json({ error: 'Solo el megaadmin puede borrar usuarios' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const userId = String(body.user_id ?? '');
  if (!userId) return json({ error: 'user_id requerido' }, 400);
  if (userId === caller.id) {
    return json({ error: 'No podés borrarte a vos mismo' }, 400);
  }

  const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
  if (deleteErr) return json({ error: deleteErr.message }, 500);

  return json({ ok: true, deleted_id: userId }, 200);
});
