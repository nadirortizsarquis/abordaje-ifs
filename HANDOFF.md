# HANDOFF — Planificador de Abordaje IFS

Punto de entrada para retomar el proyecto sin perder contexto (ej. tras reiniciar
la PC o empezar una sesión nueva de Claude). Resume las sesiones de junio 2026 y
la configuración de la máquina. Para el detalle: `STATE.md` (estado vigente) y
`CHANGELOG.md` (historia completa).

Última actualización: 2026-06-19 · Versión en producción: **2026-06-17**

---

## Acceso rápido

- **App en producción:** https://abordaje.broker-ifs.com
- **Repo:** `nadirortizsarquis/abordaje-ifs` (GitHub) — es el backup real del código.
- **Deploy:** Railway, automático en cada `push` a `main` (~1-2 min).
- **Carpeta local:** `IFS/CLAUDE/Proyecto Abordaje/` (en iCloud Drive).
- **Fuente del cliente:** `index.html` (single-file, React 18 + Babel). Es lo único
  que se edita. El build lo precompila a `public/` (ver workflow abajo).
- **Backend:** Supabase proyecto "IFS" (`hxjpnekzncqepbhpdkfv`), plan **Free**.

---

## Qué se hizo en junio 2026 (resumen)

Arrancó con una **auditoría general** (4 agentes: seguridad, código, performance,
repo/deploy) que derivó en 5 "paquetes". Todo lo de abajo está **en producción**:

1. **Paquete 1 — Que no se pierda nada:** backup diario de la base a iCloud,
   edge functions y schema versionados en el repo, `.gcp-sa-key.json` local
   borrado (vivía como secret en Supabase).
2. **Paquete 2 — Producción estable:** CDNs pineados a versión exacta,
   paginación de queries (Supabase trunca a 1000 filas sin avisar), cache
   `no-cache` del HTML, `APP_VERSION` visible en el login, smoke test `npm run check`.
3. **Paquete 3 — Performance:** precompilación del JSX en el build (el browser ya
   no baja Babel ni compila en cada visita → arranque rápido), fix doble fetch de
   Google Calendar, cache del calendario al cambiar de pestaña.
4. **Paquete 4 — Pulido UX + seguridad:** anti doble-submit en modales, copy
   unificado "prospecto", avisos de error visibles, modal propio para borrar
   gestión, código muerto eliminado, guard anti-escalada de admins en las edge
   functions de password/email.
5. **Paquete 5 — Refactor de App (PARCIAL):** extraídos `useSettings` y
   `useNotificaciones`. **Pendiente `useGcalSync`** (ver Pendientes).

**Feature nueva — Relevamiento de necesidades "8+1":** formulario estilo Life en
cada ficha de prospecto (botón → modal casi pantalla completa, 8 bloques + nota
libre, switch ARS/USD, autosave, edad automática). Botón "Descargar PDF" (v1).
Guardado en `abordaje_prospectos.relevamiento` (jsonb). Documentado en las
Instrucciones de la app (sección 3).

**Otros ajustes:** fix de logos rotos en tarjetas (regresión del build), safe-areas
del modal en mobile (notch), cursor que abre en la bitácora al abrir una tarea,
ancho adaptable en monitores ≥1600px.

---

## Configuración de ESTA máquina (lo que conviene no perder)

Un reinicio NO borra nada de esto, pero queda documentado por si hay que
reconstruirlo en otra máquina:

- **Backup automático de la base:** corre todos los días 10:00 vía launchd.
  - Script fuente: `scripts/backup-db.sh` (en el repo). Copia ejecutable:
    `~/bin/abordaje-backup-db.sh` (si se edita la del repo, recopiar ahí).
  - launchd: `~/Library/LaunchAgents/com.ifs.abordaje-db-backup.plist`.
  - Destino: `iCloud Drive → IFS/Backups Abordaje DB/` (retención 90 días).
  - Correr a mano: `bash ~/bin/abordaje-backup-db.sh`
- **Password de la DB:** en el Keychain de macOS, item `"Abordaje DB Backup"`
  (account `abordaje`). La usan el script de backup y cualquier `pg_dump`/`psql`.
- **Herramientas:** `pg_dump`/`psql` vía `brew install libpq`
  (`/opt/homebrew/opt/libpq/bin/`). Supabase CLI linkeada al proyecto.
- **Conexión a la DB (pooler IPv4):**
  `postgresql://postgres.hxjpnekzncqepbhpdkfv@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`
- **Edge functions:** versionadas en `supabase/functions/`. Deploy con
  `supabase functions deploy <slug> --use-api` o MCP. Nunca editar solo el remoto.

---

## Pendientes (nada urgente)

- **`useGcalSync`** (último paso del paquete 5): agrupar toda la lógica de Google
  Calendar en un hook. Es el código MÁS sensible (ahí vivieron los bugs de
  timezone / race conditions / borrado en Google). **Hacer en sesión dedicada,
  en local, con prueba exhaustiva del flujo de calendario antes de pushear.**
  Detalle en STATE.md (backlog).
- **Pulir el diseño del PDF** del relevamiento (la v1 es funcional). Traer
  referencias de cómo se quiere que se vea.
- **Reforzar el smoke test** para que también valide que los assets carguen
  (el bug de logos pasó el check porque solo valida que el JS compile).
- **Menores:** accesibilidad fina (htmlFor, focus trap), agregar `localhost:3000`
  a los redirects de Supabase para testear local con Google, limpiar los
  `index.backup-*.html` sueltos (la historia está en git).

---

## Cómo retomar / workflow de trabajo

1. Leer este HANDOFF, después `STATE.md` y `git log --oneline -15`.
2. **Editar** siempre `index.html` (single-file).
3. **Validar:** `npm run check` (compila el JSX con el Babel real). Para probar
   en vivo: `npm run build && PORT=3100 npm start` → http://localhost:3100
   (el 3000 suele estar ocupado por otra app). Rebuildear tras cada edición.
4. **Login local sin Google:** Google redirige a producción en local. Para probar
   con email/password, setear una clave temporal al usuario en `auth.users` y
   deshabilitarla al terminar (lo hace Claude).
5. **Antes de cambios grandes:** crear `index.backup-pre-<algo>.html` (convención,
   no se commitean).
6. **Deploy:** `git push origin main` → Railway deploya solo. El hook pre-push
   corre el smoke test. Verificar en prod que el login muestre la versión nueva.
   **No pushear sin pedido/confirmación de Nadir.**
7. **Rollback si algo sale mal:** `git revert HEAD && git push`, o en Railway
   redeploy del deploy anterior. Tag de la versión pre-cambios:
   `prod-2026-06-03-pre-paquetes`.
8. **Subir `APP_VERSION`** (constante en index.html, visible en el login) en cada
   deploy, y actualizar STATE.md/CHANGELOG al cerrar la sesión.
