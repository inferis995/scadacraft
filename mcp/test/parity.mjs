// Parity test: the MCP server's widget script processing must match the editor's
// (client/src/app/_helpers/svg-utils.ts) for every OpenBridge widget.
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { processWidget } from '../dist/fuxa/widget-script.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'parity-'));
writeFileSync(join(tmp, 'ng.js'), 'export const Injectable=()=>c=>c;export const Pipe=()=>c=>c;export class DomSanitizer{}');
await build({
  entryPoints: [join(REPO, 'client/src/app/_helpers/svg-utils.ts')], bundle: true, format: 'esm', platform: 'node',
  outfile: join(tmp, 'svg-utils.mjs'), logLevel: 'error',
  alias: { '@angular/core': join(tmp, 'ng.js'), '@angular/platform-browser': join(tmp, 'ng.js') },
});
const { SvgUtils } = await import(pathToFileURL(join(tmp, 'svg-utils.mjs')).href);

const root = join(REPO, 'server/_widgets');
const files = readdirSync(root).filter((d) => d.startsWith('openbridge'))
  .flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.svg')).map((f) => join(d, f)));
let n = 0;
for (const file of files) {
  const svg = readFileSync(join(root, file), 'utf8');
  const script = svg.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)[1];
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const idMap = Object.fromEntries(ids.map((id) => [id, `${id}_abc123`]));
  const moduleId = 'wModule_abc123';
  const ours = processWidget(script, moduleId, idMap);
  const ref = SvgUtils.processWidget(script, moduleId, idMap, undefined);
  assert.equal(ours.content, ref.content, `${file}: script differs`);
  assert.deepEqual(ours.vars, ref.vars, `${file}: variables differ`);
  n++;
}
rmSync(tmp, { recursive: true, force: true });
console.log(`parity OK: ${n} widgets match the editor's processing`);
