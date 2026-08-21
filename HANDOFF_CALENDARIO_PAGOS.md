# HANDOFF — Calendario de pagos (Abordaje)

> Para la sesión que está trabajando el **CRM** en este mismo `index.html`.
> Objetivo: que UNA sola sesión commitee y pushee **todo junto** (CRM + Calendario de pagos), sin romper nada.
> Fecha: 19-ago-2026. Autor del calendario: sesión de Claude (Nadir).

---

## TL;DR
- El **Calendario de pagos** está terminado, validado y **ya vive en `index.html`** (llegó por iCloud).
- Su parte de **base de datos YA está aplicada** al Supabase compartido (no re-aplicar).
- El **Tablero OLE ya está commiteado y deployado** aparte (no tocar nada ahí).
- Falta SOLO: **commitear + pushear `index.html` + 2 archivos de migración** de Abordaje. Eso lo hacés vos, junto con el CRM, cuando el CRM esté listo para ir a producción.
- El calendario es **seguro de shippear**: su solapa está detrás de un flag `ole_ver_calendario_pagos` que por default es **false** (solo la ven los asesores tildados). No cambia nada del resto de la app.

---

## Qué agregó el calendario (para que no lo pises al reconciliar)

Todo dentro de `index.html`. Si iCloud te marca conflicto, estos son los bloques del calendario (NO son del CRM):

**CSS** (bloque `/* ── CALENDARIO DE PAGOS ... */` y `.app-footer`):
- Clases `.calpago-*` (toolbar, chips, grilla, mini-año, modal, popover, filtro asesores, buscador).
- Footer global: `.app-footer`, `.app-footer-line`, `.app-footer-text`.

**Componentes / helpers nuevos** (top-level):
- `CalendarioPagosOLE({ effIds, nombreDe, isAdmin })` — la solapa.
- `CalpagoEditModal(...)` — modal de "quién paga" + observaciones.
- `CalpagoAsesorPicker(...)` — selector multi-asesor (en la fila de tabs).
- `buildCalpagoRoster(...)` — agrupa por libro OLE compartido (IFS = Nadir+Federico).
- Helpers `calpago*` (`calpagoNormFreq`, `calpagoParseDMY`, `calpagoDerivePagos`, `calpagoNextAnniversary`, `calpagoStyle`, `calpagoBadgeStyle`, `calpagoDayLabel`, `calpagoFmtPrima`, `calpagoPagoKey`, `calpagoNorm`, constantes `CALPAGO_*`).

**Dentro de `ViewTabs`:** prop `showCalPagos` + botón "Calendario de pagos".

**Dentro de `App`:** estado y derivados
`calPagoSel`, `calRoster`, `calPagoEffIds`, `calPagoNombreDe`; el render `{view === 'calendario_pagos' && ... <CalendarioPagosOLE .../>}`; y en la fila de tabs el label "Asesores" + `<CalpagoAsesorPicker>` (solo admin).

**Panel admin (UsuariosSection):** flag `ole_ver_calendario_pagos` en `draft`/`startEdit`/`save` + checkbox "Mostrar calendario de pagos" + badge "calendario de pagos". Y `ole_ver_calendario_pagos` agregado a los `select(...)` de `profiles` (3 lugares).

Marcadores para grep rápido: `calpago`, `CalendarioPagosOLE`, `ole_ver_calendario_pagos`, `app-footer`.

---

## Base de datos — YA APLICADA (NO re-aplicar)

Se aplicó a mano al Supabase compartido (`hxjpnekzncqepbhpdkfv`). Los archivos ya están en `supabase/migrations/`:

- `20260819150000_ole_calendario_pagos.sql` — flag `profiles.ole_ver_calendario_pagos` (default false) + helper `private.ole_can_ver_calpagos()` + reescribe `ole_reportes_select` (permite leer con CUALQUIERA de los dos flags) + tabla `ole_poliza_pago` + RLS.
- `20260819153000_ole_poliza_pago_observaciones.sql` — agrega `observaciones` + hace `paga` nullable.

> **Importante:** estos 2 archivos hay que **incluirlos en el commit** (para que el repo quede coherente), pero **NO correrlos de nuevo** contra la DB: ya están aplicados.

Además: el flag `ole_ver_calendario_pagos` ya está en `true` para Nadir (`nortiz@ifs-broker.com`) para testing.

---

## Tablero OLE — YA HECHO (no tocar)

El calendario lee `ole_reportes.resumen.cartera` (libro completo de renovaciones). Eso lo publica el Tablero OLE, que ya se commiteó y deployó por separado:
- Repo `tablero-ole-ifs`, commit `babb8dd`, deploy Railway SUCCESS.
- Cambio: `buildResumen` agrega `resumen.cartera` (todas las pólizas con renovación + frecuencia) en la vista anual.

No hace falta hacer nada del lado del Tablero.

---

## Qué tenés que hacer vos (la sesión que commitea todo)

1. Asegurate de que `index.html` tenga **las dos features** (CRM + calendario). Si iCloud sincronizó bien, ya está. Verificá con:
   ```bash
   grep -c "CalendarioPagosOLE" index.html   # > 0
   grep -c "crmSync" index.html              # > 0 (tu CRM)
   ```
2. Corré los checks (el pre-push ya corre `check`):
   ```bash
   npm run check   # transpila el JSX
   npm run smoke   # monta la app en jsdom
   ```
3. Commiteá `index.html` + los 2 archivos de migración + lo tuyo del CRM. Sugerencia de git add explícito (no `git add .`, hay backups y xlsx sueltos):
   ```bash
   git add index.html \
           supabase/migrations/20260819150000_ole_calendario_pagos.sql \
           supabase/migrations/20260819153000_ole_poliza_pago_observaciones.sql
   # + tus archivos del CRM (index.html ya incluido; sumá migraciones/functions del CRM)
   ```
4. **Push solo cuando el CRM esté listo para producción** (recordá: hoy el CRM tiene mock + edge function `crm-sync` sin deployar). El push a `main` deploya Abordaje a Railway con las dos cosas.
   - Si el CRM todavía NO está para prod: pusheá a un **branch** (`git push origin nadir/<branch>`) y abrí PR, así no deploya nada hasta mergear.

## Seguridad / por qué el calendario no rompe nada
- Solapa detrás del flag `ole_ver_calendario_pagos` (default false). Nadie la ve salvo los tildados.
- No modifica ninguna vista existente (lista, tareas, calendario, mi producción).
- Colores/pagos/observaciones son metadato visual: no afectan ningún cálculo.
- `ole_poliza_pago` es tabla nueva; el resto del schema no cambió (salvo el flag en profiles y la policy de `ole_reportes` que ahora acepta los dos flags).

## Checklist final
- [ ] `index.html` tiene CRM + calendario (grep OK)
- [ ] `npm run check` OK
- [ ] `npm run smoke` OK
- [ ] Los 2 `.sql` de migración incluidos en el commit
- [ ] CRM listo para prod (o va a branch/PR)
- [ ] Push
