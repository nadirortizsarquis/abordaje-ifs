// Build de producción: precompila el bloque JSX de index.html para que el
// browser no tenga que bajar Babel (~3 MB) ni compilar ~470 KB en cada visita.
//
// - Usa @babel/standalone 7.29.7 con presets ['react','env'] — EXACTAMENTE el
//   mismo motor y configuración que aplicaba el browser, así el JS resultante
//   es idéntico al que ya corría; solo cambia dónde se compila.
// - El index.html del repo NO cambia (sigue siendo single-file editable y
//   funciona standalone sin build, porque conserva el <script> de Babel).
// - El artefacto compilado va a public/index.html, que es lo que sirve Railway.
//
// Si algo falla, el build ABORTA (exit 1): nunca shippear un artefacto a medias.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Babel = require('@babel/standalone');

const root = new URL('..', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');

// 1. Extraer el bloque JSX
const BABEL_OPEN = '<script type="text/babel">';
const open = html.indexOf(BABEL_OPEN);
const close = html.indexOf('</script>', open);
if (open === -1 || close === -1) {
  console.error('build FALLO: no se encontró el bloque <script type="text/babel">');
  process.exit(1);
}
const jsx = html.slice(open + BABEL_OPEN.length, close);

// 2. Compilar con la misma config que babel-standalone aplica en el browser
let compiled;
try {
  compiled = Babel.transform(jsx, { presets: ['react', 'env'] }).code;
} catch (e) {
  console.error('build FALLO: el JSX no compila —', e.message.split('\n')[0]);
  process.exit(1);
}

// 3. Reemplazar el bloque por JS plano y quitar el <script> de Babel del CDN
let out = html.slice(0, open) + '<script>' + compiled + '</script>' + html.slice(close + '</script>'.length);
const babelTagRe = /<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"><\/script>\n?/;
if (!babelTagRe.test(out)) {
  console.error('build FALLO: no se encontró el <script> de Babel CDN para remover');
  process.exit(1);
}
out = out.replace(babelTagRe, '');

// Sanity: el artefacto no debe tener restos de babel
if (out.includes('text/babel') || out.includes('@babel/standalone')) {
  console.error('build FALLO: el artefacto todavía referencia a Babel');
  process.exit(1);
}

// 4. Escribir public/
mkdirSync(new URL('public', root), { recursive: true });
writeFileSync(new URL('public/index.html', root), out);
cpSync(new URL('serve.json', root), new URL('public/serve.json', root));
cpSync(new URL('static', root), new URL('public/static', root), { recursive: true });

const kb = n => Math.round(n / 1024) + ' KB';
console.log(`build OK: JSX ${kb(jsx.length)} → compilado ${kb(compiled.length)} · index.html final ${kb(out.length)} (sin Babel CDN)`);
