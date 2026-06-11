// Smoke test pre-push: verifica que el bloque JSX de index.html compile con
// el mismo Babel standalone que usa el browser. Atrapa errores de sintaxis
// que dejarían la app en pantalla blanca, ANTES de pushear a producción.
// Uso: npm run check  (lo corre también el hook .git/hooks/pre-push)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Babel = require('@babel/standalone');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const m = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('check FALLO: no se encontro el bloque <script type="text/babel">');
  process.exit(1);
}

try {
  // Mismos presets que aplica babel-standalone en el browser cuando el
  // script no declara data-presets: ['react', 'env'].
  Babel.transform(m[1], { presets: ['react', 'env'] });
  console.log(`check OK: JSX compila (${Math.round(m[1].length / 1024)} KB)`);
} catch (e) {
  console.error('check FALLO: el JSX no compila —', e.message.split('\n')[0]);
  process.exit(1);
}
