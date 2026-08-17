// Smoke test de render (single-file): extrae el bloque JSX de index.html, lo
// transpila y MONTA la app en jsdom con Supabase stubeado (sesión admin), para
// atrapar ReferenceErrors / crashes de render que el transpilar (check.mjs) no ve.
// Corre por pre-push hook: si falla, bloquea el push (y el deploy).
//
//   node scripts/smoke.mjs
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import Babel from '@babel/standalone';
import React from 'react';
import { createRoot } from 'react-dom/client';

const fail = (msg, err) => {
  console.error('X smoke FALLO: ' + msg);
  if (err) console.error(err.stack || err.message || String(err));
  process.exit(1);
};

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// Abordaje separa el setup (auth, sb, constantes) en un <script> plano y los
// componentes en <script type="text/babel">. Hay que correr AMBOS en orden
// (los scripts clásicos comparten el scope léxico global -> los const del setup
// quedan accesibles para los componentes). Los <script src=...> (CDN) los cubren
// los stubs/imports, se saltean.
const scripts = [];
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let mm;
while ((mm = re.exec(html))) {
  const attrs = mm[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;            // CDN externo
  let body = mm[2];
  if (/text\/babel/.test(attrs)) {
    try { body = Babel.transform(body, { presets: [['react', { runtime: 'classic' }]] }).code; }
    catch (e) { fail('el JSX no transpila (error de sintaxis)', e); }
  }
  scripts.push(body);
}
if (!scripts.length) fail('no encontré scripts inline en index.html');

// Mount points reales del index.html + targets de portales.
const dom = new JSDOM(
  '<!DOCTYPE html><html><body>' +
  '<div id="loginRoot"></div><div id="reactRoot"></div>' +
  '<div id="appContent"></div><div id="headerActions"></div><div id="headerSearch"></div>' +
  '</body></html>',
  { url: 'https://abordaje.broker-ifs.com/', pretendToBeVisual: true, runScripts: 'dangerously' },
);
const { window } = dom;

const PROFILE = {
  id: 'test-admin', email: 'nortiz@ifs-broker.com', display_name: 'Nadir', role: 'admin',
  advisor_name_ole: 'INSURANCE FINANCIAL SOLUTION LLC', ole_ver_produccion: true,
  abordaje_settings: {}, gcal_enabled: false, assistant_of_id: null,
  shares_calendar_with_assistant: false,
};
const session = { user: { id: 'test-admin', email: 'nortiz@ifs-broker.com' } };
// Query builder stub: TODO encadenable (select/eq/insert/update/order/...) y a la
// vez thenable (await resuelve). single/maybeSingle devuelven el perfil admin.
const query = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'then') return (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
    if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve({ data: PROFILE, error: null });
    return () => query; // select/eq/order/insert/update/delete/upsert/not/in/... -> encadenable
  },
});
window.supabase = {
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: () => Promise.resolve({ data: { session }, error: null }),
      signInWithOAuth: () => Promise.resolve({ error: null }),
      signOut: () => Promise.resolve({ error: null }),
      getUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
    },
    from: () => query,
    rpc: () => Promise.resolve({ data: [], error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  }),
};
window.XLSX = { read: () => ({ SheetNames: [], Sheets: {} }), utils: { sheet_to_json: () => [], json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} } };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.HTMLCanvasElement.prototype.getContext = () => ({
  fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
  arc() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, closePath() {},
  measureText: () => ({ width: 0 }), fillText() {}, setLineDash() {}, drawImage() {},
  createLinearGradient: () => ({ addColorStop() {} }),
});
window.HTMLElement.prototype.focus = () => {};
window.HTMLElement.prototype.blur = () => {};
window.React = React;
window.ReactDOM = { createRoot, createPortal: (children) => children };
global.window = window;
global.document = window.document;

const errors = [];
window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));
process.on('uncaughtException', (e) => errors.push(e));
const origErr = console.error;
console.error = (...a) => {
  const s = a.map(String).join(' ');
  if (/ReferenceError|TypeError|is not defined|Cannot read propert|error boundary/.test(s)) errors.push(new Error(s));
  origErr.apply(console, a);
};

try {
  // Inyectar como <script> real (scoping fiel al browser; window.eval le pierde el
  // scope de los const top-level en un script tan grande). El bloque llama
  // window.__abordajeMount() al final -> monta Root + AppShell.
  for (const body of scripts) {
    const s = window.document.createElement('script');
    s.textContent = body;
    window.document.body.appendChild(s);
  }
} catch (e) {
  fail('la app tiró un error al montar (render inicial)', e);
}

await new Promise((r) => setTimeout(r, 250));

if (errors.length) {
  const real = errors.find((e) => e && e.stack && !/above error occurred/.test(e.message || '')) || errors[0];
  fail('error de runtime al renderizar', real);
}
const txt = (window.document.getElementById('reactRoot')?.textContent || '') +
            (window.document.getElementById('loginRoot')?.textContent || '');
if (txt.trim().length < 15) fail(`el árbol quedó vacío tras montar (len=${txt.trim().length}) — probable crash de render`);

console.log(`✓ smoke OK: la app montó y renderizó (~${txt.trim().length} chars, sin errores de runtime).`);
process.exit(0);
