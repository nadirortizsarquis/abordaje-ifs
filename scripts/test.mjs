// Tests de invariantes (auditoría Fase 4). Bloquea regresiones de la lógica pura
// que es la más frágil y la que arreglamos en Fase 0/2: parseo de fechas local,
// deriveEstado (con backtrack), normalización de documento y color-por-tipo.
//
// Estrategia: forzamos TZ Argentina (UTC-3) ANTES de cualquier Date, inyectamos
// los <script> de index.html en jsdom como hace el smoke (las funciones top-level
// quedan como globals de window) y afirmamos invariantes sobre ellas.
//
//   node scripts/test.mjs
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import Babel from '@babel/standalone';
import React from 'react';
import { createRoot } from 'react-dom/client';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [];
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let mm;
while ((mm = re.exec(html))) {
  const attrs = mm[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;
  let body = mm[2];
  if (/text\/babel/.test(attrs)) {
    body = Babel.transform(body, { presets: [['react', { runtime: 'classic' }]] }).code;
  }
  scripts.push(body);
}

const dom = new JSDOM(
  '<!DOCTYPE html><html><body>' +
  '<div id="loginRoot"></div><div id="reactRoot"></div>' +
  '<div id="appContent"></div><div id="headerActions"></div><div id="headerSearch"></div>' +
  '</body></html>',
  { url: 'https://abordaje.broker-ifs.com/', pretendToBeVisual: true, runScripts: 'dangerously' },
);
const { window } = dom;

// Stubs mínimos (mismos que smoke) para que el bloque monte sin explotar.
const PROFILE = { id: 'test-admin', email: 'nortiz@ifs-broker.com', role: 'admin', assistant_of_id: null, abordaje_settings: {}, gcal_enabled: false };
const session = { user: { id: 'test-admin', email: 'nortiz@ifs-broker.com' } };
const query = new Proxy({}, { get(_t, prop) {
  if (prop === 'then') return (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
  if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve({ data: PROFILE, error: null });
  return () => query;
} });
window.supabase = { createClient: () => ({
  auth: {
    getSession: () => Promise.resolve({ data: { session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
    signInWithPassword: () => Promise.resolve({ data: { session }, error: null }),
    signInWithOAuth: () => Promise.resolve({ error: null }), signOut: () => Promise.resolve({ error: null }),
  },
  from: () => query, rpc: () => Promise.resolve({ data: [], error: null }),
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {},
}) };
window.XLSX = { read: () => ({ SheetNames: [], Sheets: {} }), utils: { sheet_to_json: () => [], json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} } };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: () => ({ width: 0 }), fillText() {}, fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, closePath() {}, setLineDash() {}, drawImage() {}, createLinearGradient: () => ({ addColorStop() {} }) });
window.HTMLElement.prototype.focus = () => {}; window.HTMLElement.prototype.blur = () => {};
window.React = React; window.ReactDOM = { createRoot, createPortal: (c) => c };
global.window = window; global.document = window.document;

for (const body of scripts) {
  const s = window.document.createElement('script');
  s.textContent = body;
  window.document.body.appendChild(s);
}

// ── Helpers de test ──────────────────────────────────────────────────────────
let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const g = (n) => {
  const f = window[n];
  if (typeof f !== 'function') throw new Error(`la función global '${n}' no está definida (¿se renombró?)`);
  return f;
};

// ── parseFechaLocal: date-only NO se corre de día en TZ negativa ──────────────
test('parseFechaLocal no corre el día en UTC-3', () => {
  const d = g('parseFechaLocal')('2026-08-24');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);      // agosto (0-based)
  assert.equal(d.getDate(), 24);      // NO 23
  // control: el bug clásico SÍ se corre en esta TZ (garantiza que el test es real)
  assert.equal(new Date('2026-08-24').getDate(), 23);
});

// ── deriveEstado: backtrack de agendado/recordatorio sin fecha ────────────────
test('deriveEstado: vacío -> nuevo', () => {
  assert.equal(g('deriveEstado')({ contactos: [] }), 'nuevo');
});
test('deriveEstado: agendado con fecha -> agendado', () => {
  assert.equal(g('deriveEstado')({ contactos: [{ tipo: 'agendado', agendadoPara: '2026-09-01T10:00' }] }), 'agendado');
});
test('deriveEstado: agendado SIN fecha retrocede al contacto previo', () => {
  const est = g('deriveEstado')({ contactos: [
    { tipo: 'llamar_manana', agendadoPara: '2026-09-01' },
    { tipo: 'agendado', agendadoPara: null },   // cita cancelada desde el calendar
  ] });
  assert.equal(est, 'pendiente');   // NO se queda pegado en 'agendado'
});
test('deriveEstado: rechazado -> rechazado', () => {
  assert.equal(g('deriveEstado')({ contactos: [{ tipo: 'rechazado' }] }), 'rechazado');
});

// ── normDoc: puntos/espacios/guiones no cuentan ──────────────────────────────
test('normDoc normaliza puntuación del documento', () => {
  const n = g('normDoc');
  assert.equal(n('12.345.678'), '12345678');
  assert.equal(n('12 345 678'), '12345678');
  assert.equal(n('12-345-678'), '12345678');
  assert.equal(n('12.345.678'), n('12345678'));
});

// ── dedup de prospectos: DNI con y sin puntos matchea ────────────────────────
test('buscarDuplicadosProspecto matchea DNI normalizado', () => {
  const prospectos = [{ id: 'a', nombre: 'Juan Perez', telefono: '', documento: '12.345.678', archivado: false }];
  const dups = g('buscarDuplicadosProspecto')(prospectos, { nombre: '', telefono: '', documento: '12345678' });
  assert.equal(dups.length, 1);
  assert.equal(dups[0].id, 'a');
});
test('agruparDuplicados agrupa por DNI normalizado', () => {
  const prospectos = [
    { id: 'a', nombre: 'Juan Perez', telefono: '', documento: '12.345.678', archivado: false },
    { id: 'b', nombre: 'J Perez',    telefono: '', documento: '12345678',   archivado: false },
  ];
  const grupos = g('agruparDuplicados')(prospectos);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].length, 2);
});

// ── calColorPorTipo: tabla única, distingue tipos que antes colapsaban ───────
test('calColorPorTipo distingue fecha_exacta de llamar_manana', () => {
  const c = g('calColorPorTipo');
  const fe = c('fecha_exacta'), lm = c('llamar_manana');
  assert.ok(fe && lm, 'ambos deben resolver a un color');
  assert.notEqual(fe.bg, lm.bg);              // ya no es el mismo amarillo
  assert.equal(c('desconocido_xyz'), null);   // tipo desconocido -> null (cae a violeta en el caller)
});

// ── Núcleo del motor de seguimiento (refactor #32): decidirSeguimiento ───────
test('decidirSeguimiento: sin contacto -> nada', () => {
  assert.equal(g('decidirSeguimiento')(null), 'nada');
});
test('decidirSeguimiento: contacto sin agendadoPara -> nada', () => {
  assert.equal(g('decidirSeguimiento')({ tipo: 'contestador', agendadoPara: null }), 'nada');
});
test('decidirSeguimiento: agendado con fecha -> agenda', () => {
  assert.equal(g('decidirSeguimiento')({ tipo: 'agendado', agendadoPara: '2026-09-01T10:00' }), 'agenda');
});
test('decidirSeguimiento: llamar_manana con fecha -> tarea', () => {
  assert.equal(g('decidirSeguimiento')({ tipo: 'llamar_manana', agendadoPara: '2026-09-01' }), 'tarea');
});
test('decidirSeguimiento: recordatorio con fecha -> tarea (no es agendado)', () => {
  assert.equal(g('decidirSeguimiento')({ tipo: 'recordatorio', agendadoPara: '2026-09-01T10:00' }), 'tarea');
});

// ── Núcleo del motor de seguimiento (refactor #32): pickColumnaAbordar ───────
test('pickColumnaAbordar: prefiere la columna con slug abordar', () => {
  const cols = [{ id: 'x', slug: null, orden: 0 }, { id: 'ab', slug: 'abordar', orden: 5 }];
  assert.equal(g('pickColumnaAbordar')(cols).id, 'ab');
});
test('pickColumnaAbordar: sin abordar -> primera por orden', () => {
  const cols = [{ id: 'b', slug: null, orden: 2 }, { id: 'a', slug: null, orden: 1 }];
  assert.equal(g('pickColumnaAbordar')(cols).id, 'a');
});
test('pickColumnaAbordar: sin columnas -> null', () => {
  assert.equal(g('pickColumnaAbordar')([]), null);
  assert.equal(g('pickColumnaAbordar')(undefined), null);
});

// ── Núcleo del motor de seguimiento (refactor #32): buildObsTarea ────────────
test('buildObsTarea: junta label del tipo + observación con " — "', () => {
  assert.equal(g('buildObsTarea')('llamar_manana', 'Insistir'), 'Llamar mañana — Insistir');
});
test('buildObsTarea: omite la observación vacía (solo el label)', () => {
  assert.equal(g('buildObsTarea')('contestador', ''), 'Contestador');
});

// ── Núcleo del motor de seguimiento (refactor #32): appendBitacora ───────────
test('appendBitacora: nota vacía -> undefined (sin cambio)', () => {
  assert.equal(g('appendBitacora')('algo', ''), undefined);
});
test('appendBitacora: observación vacía -> la nota tal cual', () => {
  assert.equal(g('appendBitacora')('', 'Nueva'), 'Nueva');
});
test('appendBitacora: agrega con separador si no estaba', () => {
  assert.equal(g('appendBitacora')('Vieja', 'Nueva'), 'Vieja\n· Nueva');
});
test('appendBitacora: si ya está incluida -> undefined (no duplica)', () => {
  assert.equal(g('appendBitacora')('Vieja\n· Nueva', 'Nueva'), undefined);
});

// ── combinarFechaHora (refactor #32): inversa de splitFechaHora ──────────────
test('combinarFechaHora: sin fecha -> null', () => {
  assert.equal(g('combinarFechaHora')(null, '10:00'), null);
});
test('combinarFechaHora: fecha + hora -> ISO con T', () => {
  assert.equal(g('combinarFechaHora')('2026-09-01', '10:00'), '2026-09-01T10:00');
});
test('combinarFechaHora: fecha sin hora -> date-only', () => {
  assert.equal(g('combinarFechaHora')('2026-09-01', null), '2026-09-01');
});
test('combinarFechaHora + splitFechaHora: round-trip', () => {
  const iso = g('combinarFechaHora')('2026-09-01', '14:30');
  const { fecha, hora } = g('splitFechaHora')(iso);
  assert.equal(fecha, '2026-09-01');
  assert.equal(hora, '14:30');
});

// ── deriveProximoContacto / ultimoContactoConFecha (refactor #32) ────────────
test('deriveProximoContacto: toma la fecha del ÚLTIMO contacto con fecha', () => {
  const cs = [
    { tipo: 'llamar_manana', agendadoPara: '2026-09-01' },
    { tipo: 'agendado', agendadoPara: '2026-09-10T10:00' },
  ];
  assert.equal(g('deriveProximoContacto')(cs), '2026-09-10T10:00');
});
test('deriveProximoContacto: ignora los contactos sin fecha (retrocede)', () => {
  const cs = [
    { tipo: 'llamar_manana', agendadoPara: '2026-09-01' },
    { tipo: 'contestador', agendadoPara: null },
  ];
  assert.equal(g('deriveProximoContacto')(cs), '2026-09-01');
});
test('deriveProximoContacto: ninguno con fecha -> null', () => {
  assert.equal(g('deriveProximoContacto')([{ tipo: 'contestador', agendadoPara: null }]), null);
  assert.equal(g('deriveProximoContacto')([]), null);
});
test('ultimoContactoConFecha: devuelve el contacto (no la fecha)', () => {
  const c2 = { tipo: 'agendado', agendadoPara: '2026-09-10T10:00' };
  assert.equal(g('ultimoContactoConFecha')([{ tipo: 'contestador' }, c2]), c2);
});

// ── Correr ───────────────────────────────────────────────────────────────────
let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}
console.log(`\n${failed ? 'X' : '✓'} tests: ${passed}/${cases.length} OK${failed ? `, ${failed} FALLARON` : ''}`);
process.exit(failed ? 1 : 0);
