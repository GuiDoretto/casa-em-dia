import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--url' || args[2] !== '--env-file') {
  throw new Error('Uso: node scripts/create-admin.mjs --url https://SEU_WORKER.workers.dev --env-file .env.admin');
}
const url = new URL(args[1]);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
  throw new Error('Use somente a origem HTTPS da aplicação.');
}
loadEnvFile(resolve(root, args[3]));
const password = process.env.CASA_ADMIN_PASSWORD;
if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
  throw new Error('Defina CASA_ADMIN_PASSWORD no arquivo local ignorado, com 10 a 128 caracteres.');
}
delete process.env.CASA_ADMIN_PASSWORD;

function wrangler(args, input = '') {
  return new Promise((yes, no) => {
    const child = spawn(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    });
    child.once('error', () => no(new Error('Não foi possível iniciar o Wrangler.')));
    child.once('exit', code => code === 0 ? yes() : no(new Error('Wrangler encerrou sem concluir a operação.')));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function loginAndVerify(retry = false) {
  let response;
  for (let attempt = 0; attempt < (retry ? 6 : 1); attempt++) {
    response = await fetch(url.origin + '/api/login', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Origin: url.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin', password }),
    });
    if (response.ok || !retry || attempt === 5 || ![401, 500, 502, 503].includes(response.status)) break;
    await response.body?.cancel();
    console.log('Aguardando a propagação da configuração administrativa...');
    await new Promise(yes => setTimeout(yes, 10000));
  }
  assert.equal(response.status, 200, 'O login admin não foi confirmado; uma conta existente nunca tem sua senha substituída.');
  const state = await response.json();
  assert.equal(state.user.id, 'admin');
  assert.equal(state.user.role, 'admin');
  assert.ok(Array.isArray(state.users));
  const cookie = response.headers.get('Set-Cookie')?.split(';')[0];
  assert.ok(cookie);
  try {
    const exported = await fetch(url.origin + '/api/export', {
      headers: { Cookie: cookie }, redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    await exported.body?.cancel();
    assert.equal(exported.status, 200, 'A permissão administrativa não foi confirmada.');
  } finally {
    const logout = await fetch(url.origin + '/api/logout', {
      method: 'POST', headers: { Origin: url.origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    await logout.body?.cancel();
    assert.equal(logout.status, 200);
  }
}

const salt = randomBytes(16).toString('hex');
const credential = JSON.stringify({ salt, digest: scryptSync(password, salt, 64).toString('hex') });
let installed = false;
try {
  await wrangler(['secret', 'bulk'], JSON.stringify({ CASA_ADMIN_BOOTSTRAP: credential }));
  installed = true;
  await loginAndVerify(true);
} finally {
  if (installed) await wrangler(['secret', 'delete', 'CASA_ADMIN_BOOTSTRAP'], 'y\n');
}
await loginAndVerify();
console.log(JSON.stringify({ ok: true, origin: url.origin, username: 'admin', role: 'admin', bootstrapRemoved: true }));
