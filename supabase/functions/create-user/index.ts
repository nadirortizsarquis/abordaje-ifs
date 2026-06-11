// Edge Function — Crear un user nuevo desde la app.
//
// Solo invocable por un admin autenticado. Usa service_role internamente
// para crear el user en auth.users (auto-confirmado) y luego upsert
// el row de public.profiles con los metadatos.
//
// Compartida entre todas las apps IFS bajo el mismo Supabase project:
// los users creados desde el Tablero de Comisiones también pueden loguear
// en Abordaje, BTP, etc.
import { requireAdmin, json } from './_shared/admin-auth.ts';

Deno.serve(async req => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const displayName = String(body.display_name ?? '').trim();
  const role = String(body.role ?? 'agent');
  const advisorNameOle = String(body.advisor_name_ole ?? '').trim();

  if (!email) return json({ error: 'Email requerido' }, 400);
  if (!password || password.length < 8) {
    return json({ error: 'Password requerido (mínimo 8 caracteres)' }, 400);
  }
  if (role !== 'agent' && role !== 'admin') {
    return json({ error: 'Role inválido (admin o agent)' }, 400);
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) return json({ error: createErr.message }, 400);
  if (!created.user) return json({ error: 'No se pudo crear el usuario' }, 500);

  // UPSERT en profiles. Si el trigger handle_new_user está activo,
  // ya creó el row con role='agent' por default → este upsert lo actualiza.
  // Si el trigger no se disparó (visto en Supabase Free en algunas operaciones),
  // el upsert lo crea. Robusto a ambos casos.
  const { error: upsertErr } = await admin
    .from('profiles')
    .upsert({
      id: created.user.id,
      email: created.user.email,
      display_name: displayName || null,
      advisor_name_ole: advisorNameOle || null,
      role,
    });
  if (upsertErr) {
    // Cleanup: si falla, borramos el user para no dejar inconsistencia
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: 'Error guardando el perfil: ' + upsertErr.message }, 500);
  }

  return json({
    id: created.user.id,
    email: created.user.email,
    display_name: displayName,
    role,
    advisor_name_ole: advisorNameOle,
  }, 200);
});
