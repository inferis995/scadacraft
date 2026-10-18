// Extract the OpenBridge icons (obi-* web components) as plain SVG files for ScadaCraft:
// menu, header and button icons ("ob:<name>"), map markers. Usage:
//   node make-icons.mjs <path to @oicl/openbridge-webcomponents>
// (build-bundle.sh installs the package and calls this script).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = process.argv[2];
if (!pkg) { console.error('usage: node make-icons.mjs <openbridge-webcomponents package dir>'); process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'client', 'src', 'assets', 'lib', 'openbridge', 'icons');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const src = join(pkg, 'dist', 'icons');
const names = [];
for (const f of readdirSync(src).filter((x) => /^icon-.*\.js$/.test(x)).sort()) {
  const js = readFileSync(join(src, f), 'utf8');
  const m = js.match(/this\.icon = svg`([\s\S]*?)`;/);
  if (!m) continue;
  const name = f.replace(/^icon-/, '').replace(/\.js$/, '');
  // single-colour version (currentColor): used as a CSS mask, so it takes the text colour
  const svg = m[1].trim().replace(/\s*\n\s*/g, ' ');
  writeFileSync(join(out, `${name}.svg`), svg + '\n');
  names.push(name);
}
writeFileSync(join(out, 'icons.json'), JSON.stringify(names));
console.log(`${names.length} OpenBridge icons written to ${out}`);
