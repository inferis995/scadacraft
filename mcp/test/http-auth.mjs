// HTTP transport security: localhost-only without a token, bearer token required otherwise,
// refusal to listen on the network without a token. Does not need a running ScadaCraft.
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'dist', 'index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(env) {
  const p = spawn(process.execPath, [entry], { env: { ...process.env, TRANSPORT: 'http', ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  return { p, log: () => err };
}
async function waitListening(s) {
  for (let i = 0; i < 50; i++) { if (/on http:\/\//.test(s.log())) return; await sleep(100); }
  throw new Error(`server did not start: ${s.log()}`);
}
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
const post = (port, headers = {}) => fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(init),
});

// 1. network address without token: refuses to start
{
  const s = start({ HOST: '0.0.0.0', PORT: '3911', SCADACRAFT_MCP_TOKEN: '' });
  const code = await new Promise((r) => s.p.on('exit', r));
  assert.equal(code, 1);
  assert.match(s.log(), /Refusing to listen/);
}
// 2. short token refused
{
  const s = start({ HOST: '0.0.0.0', PORT: '3912', SCADACRAFT_MCP_TOKEN: 'short' });
  assert.equal(await new Promise((r) => s.p.on('exit', r)), 1);
}
// 3. token required
{
  const token = 'a'.repeat(16) + Math.random().toString(36).slice(2) + 'b'.repeat(16);
  const s = start({ HOST: '0.0.0.0', PORT: '3913', SCADACRAFT_MCP_TOKEN: token });
  try {
    await waitListening(s);
    assert.equal((await post(3913)).status, 401, 'no token');
    assert.equal((await post(3913, { Authorization: 'Bearer wrong-token-wrong-token-xx' })).status, 401, 'wrong token');
    const ok = await post(3913, { Authorization: `Bearer ${token}` });
    assert.equal(ok.status, 200, 'right token');
    assert.equal((await ok.json()).result.serverInfo.name, 'scadacraft-mcp-server');
    assert.equal((await fetch('http://127.0.0.1:3913/mcp', { headers: { Authorization: `Bearer ${token}` } })).status, 405);
  } finally { s.p.kill(); }
}
// 4. localhost without token: works, but a foreign Host header (DNS rebinding) is rejected
{
  const s = start({ HOST: '127.0.0.1', PORT: '3914', SCADACRAFT_MCP_TOKEN: '' });
  try {
    await waitListening(s);
    assert.equal((await post(3914)).status, 200);
    // fetch cannot set Host: use http.request
    const status = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: 3914, path: '/mcp', method: 'POST',
        headers: { Host: 'evil.example.com', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } },
      (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', reject); r.end(JSON.stringify(init));
    });
    assert.equal(status, 403, 'DNS rebinding protection');
  } finally { s.p.kill(); }
}
console.log('http-auth OK');
