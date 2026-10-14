// Bundle the OpenBridge guide and widget reference with the server (exposed as MCP resources).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'docs');
mkdirSync(out, { recursive: true });
for (const f of ['openbridge.md', 'openbridge-widgets.md']) cpSync(join(here, '..', '..', 'docs', f), join(out, f));
console.log('docs copied');
