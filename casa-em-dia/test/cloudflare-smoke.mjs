import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { compareManifests } from '../cloudflare/data-transfer.mjs';
import { localNow } from '../rules.mjs';

// Real workerd + DO SQLite, exclusively disposable state and fake local tokens.
// No Cloudflare account, production database, or delivery provider is used.
const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'casa-cloudflare-test-'));
const setupToken = 'local-test-setup-token-not-a-production-secret';
const migrationToken = 'local-test-migration-token-not-a-production-secret';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
let child, browser;

async function freePort() {
  const server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const port = server.address().port;
  await new Promise(yes => server.close(yes));
  return port;
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  const owned = child;
  const exited = new Promise(yes => owned.once('exit', yes));
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(owned.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else owned.kill('SIGTERM');
  await exited;
  child = null;
}

async function start(name, migration, bootstrap = '') {
  await stop();
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  const envFile = join(temporary, 'test.env');
  writeFileSync(envFile, [
    'CASA_SETUP_TOKEN=' + setupToken, 'CASA_MIGRATION_TOKEN=' + migrationToken,
    'CASA_ADMIN_BOOTSTRAP=' + bootstrap,
    'CASA_MIGRATION_ENABLED=' + Number(migration), 'CASA_SCHEDULE_ENABLED=0',
    'CASA_SMS_ENABLED=0', 'BREVO_API_KEY=', 'BREVO_FROM_EMAIL=', 'CASA_PUBLIC_URL=',
  ].join('\n'), { mode: 0o600 });
  child = spawn(process.execPath, [
    resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local',
    '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0',
    '--persist-to', join(temporary, name), '--env-file', envFile,
    '--log-level', 'error', '--show-interactive-dev-session=false',
  ], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true', CLOUDFLARE_API_TOKEN: '', CF_API_TOKEN: '', BREVO_API_KEY: '', BREVO_FROM_EMAIL: '', CASA_SMS_ENABLED: '0', CASA_ADMIN_BOOTSTRAP: '' },
  });
  let diagnostic = '';
  child.stdout.on('data', value => { diagnostic = (diagnostic + value).slice(-6000); });
  child.stderr.on('data', value => { diagnostic = (diagnostic + value).slice(-6000); });
  child.once('error', error => { diagnostic += error.message; });
  const started = Date.now();
  while (Date.now() - started < 60000) {
    if (child.exitCode !== null) throw new Error('O runtime local encerrou: ' + diagnostic);
    try {
      const response = await fetch(base + '/api/bootstrap', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return base;
      diagnostic += ' bootstrap HTTP ' + response.status + ' ' + await response.text();
    } catch {}
    await new Promise(yes => setTimeout(yes, 150));
  }
  throw new Error('O runtime local não iniciou: ' + diagnostic);
}

async function call(base, path, data, cookie = '', extra = {}) {
  const response = await fetch(base + '/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { Origin: base, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const value = await response.json();
  return { status: response.status, data: value, cookie: response.headers.get('Set-Cookie')?.split(';')[0], headers: response.headers };
}

async function admin(base, path, snapshot, authorized = true) {
  const response = await fetch(base + '/__admin/' + path, {
    method: snapshot === undefined ? 'GET' : 'POST',
    headers: { ...(authorized ? { Authorization: 'Bearer ' + migrationToken } : {}), ...(snapshot === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: snapshot === undefined ? undefined : JSON.stringify(snapshot),
  });
  return { status: response.status, data: await response.json() };
}

function ok(result, label) {
  assert.equal(result.status, 200, label + ': ' + (result.data.error || result.status));
  return result;
}

try {
  let base = await start('source', false);
  const pageResponse = await fetch(base + '/');
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /Casa em Dia/);
  assert.equal(pageResponse.headers.get('X-Frame-Options'), 'DENY');
  assert.equal((await fetch(base + '/convite')).status, 200);
  assert.match((await fetch(base + '/sw.js')).headers.get('Cache-Control'), /no-cache/);
  assert.equal((await admin(base, 'manifest')).status, 404);
  assert.equal((await call(base, 'state')).status, 401);
  const setup = { houseName: 'Casa Worker', name: 'Admin Worker', email: 'admin@worker.test', phone: '', password: 'Senha Worker 2026!' };
  assert.equal((await call(base, 'setup', setup)).status, 403);
  const first = ok(await call(base, 'setup', setup, '', { 'X-Setup-Token': setupToken }), 'setup');
  const cookie = first.cookie, adminId = first.data.user.id;
  assert.match(first.headers.get('Set-Cookie'), /HttpOnly.*SameSite=Strict/);
  assert.equal(first.data.notifications.email.configured, false);
  ok(await call(base, 'settings', { ...first.data.settings, disabledDays: [], skipHolidays: false, autoGenerate: false }, cookie), 'settings');
  const invited = ok(await call(base, 'save-user', { name: 'Bruno Worker', email: 'bruno@worker.test', phone: '', active: true }, cookie), 'invite');
  const member = ok(await call(base, 'accept-invite', { token: invited.data.inviteToken, password: 'Senha Bruno 2026!' }), 'accept-invite');
  const memberId = member.data.user.id, memberCookie = member.cookie;
  assert.equal((await call(base, 'accept-invite', { token: invited.data.inviteToken, password: 'Senha Bruno 2026!' })).status, 400);
  assert.equal((await call(base, 'settings', first.data.settings, memberCookie)).status, 403);
  const day = localNow().date;
  const own = ok(await call(base, 'save-task', { title: 'Concluir no Worker', area: 'Sala', duration: 10, deadline: '23:59', due_date: day, assignee_id: memberId }, cookie), 'save-task');
  const ownId = own.data.tasks.find(task => task.title === 'Concluir no Worker').id;
  const completed = await Promise.all([call(base, 'complete', { id: ownId }, memberCookie), call(base, 'complete', { id: ownId }, memberCookie)]);
  assert.deepEqual(completed.map(result => result.status).sort(), [200, 409]);
  let date = new Date(day + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + 1);
  const future = date.toISOString().slice(0, 7) === day.slice(0, 7) ? date.toISOString().slice(0, 10) : day;
  const aResult = ok(await call(base, 'save-task', { title: 'Troca A', area: 'Sala', duration: 10, deadline: '23:59', due_date: future, assignee_id: memberId }, cookie), 'swap task A');
  const a = aResult.data.tasks.find(task => task.title === 'Troca A');
  const bResult = ok(await call(base, 'save-task', { title: 'Troca B', area: 'Sala', duration: 10, deadline: '23:59', due_date: future, assignee_id: adminId }, cookie), 'swap task B');
  const b = bResult.data.tasks.find(task => task.title === 'Troca B');
  const swap = ok(await call(base, 'swap', { taskA: a.id, taskB: b.id }, memberCookie), 'swap');
  const swapId = swap.data.swaps[0].id;
  const accepted = await Promise.all([call(base, 'resolve-swap', { id: swapId, action: 'accepted' }, cookie), call(base, 'resolve-swap', { id: swapId, action: 'accepted' }, cookie)]);
  assert.deepEqual(accepted.map(result => result.status).sort(), [200, 409]);
  const drawing = ok(await call(base, 'draw', { date: future }, cookie), 'draw');
  assert.equal(drawing.data.created.length, 4);
  assert.equal(ok(await call(base, 'draw', { date: future }, cookie), 'repeat draw').data.created.length, 0);
  ok(await call(base, 'profile-photo', { photo: 'data:image/png;base64,' + image }, memberCookie), 'photo');
  const before = ok(await call(base, 'state', undefined, cookie), 'state').data;
  const photoUrl = before.users.find(user => user.id === memberId).photo_url;
  assert.equal((await fetch(base + photoUrl)).status, 401);
  assert.deepEqual(Buffer.from(await (await fetch(base + photoUrl, { headers: { Cookie: cookie } })).arrayBuffer()), Buffer.from(image, 'base64'));
  assert.equal((await call(base, 'reset-calendar', { confirmation: 'incorreta' }, cookie)).status, 400);
  assert.equal(ok(await call(base, 'state', undefined, cookie), 'rollback state').data.tasks.length, before.tasks.length);

  if (process.argv.includes('--browser')) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, channel: process.env.CASA_BROWSER_CHANNEL || 'chrome' });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('input[name=email]').fill(setup.email);
    await page.locator('input[name=password]').fill(setup.password);
    await page.locator('form button[type=submit]').click();
    await page.getByRole('heading', { name: 'Tudo em dia, casa leve.' }).waitFor();
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    const artifacts = resolve(root, 'work', 'cloudflare-check'); mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, 'mobile.png'), fullPage: true });
    await browser.close(); browser = null;
  }

  console.log('OK workerd: assets, login, convites, permissões, transações concorrentes, sorteios e fotos.');
  base = await start('source', true);
  assert.equal((await admin(base, 'export', undefined, false)).status, 401);
  assert.equal((await call(base, 'login', { email: setup.email, password: setup.password })).status, 503);
  const snapshot = ok(await admin(base, 'export'), 'full export').data;
  assert.equal(snapshot.tables.length, 13);
  const userTable = snapshot.tables.find(table => table.name === 'users');
  const savedAdmin = userTable.rows.find(row => row[userTable.columns.indexOf('id')] === adminId);
  assert.equal(savedAdmin[userTable.columns.indexOf('password_hash')], scryptSync(setup.password, savedAdmin[userTable.columns.indexOf('password_salt')], 64).toString('hex'));
  assert.ok(compareManifests(snapshot.manifest, ok(await admin(base, 'manifest'), 'source manifest').data).equal);
  base = await start('target', true);
  const invalid = structuredClone(snapshot); invalid.manifest.sha256 = '0'.repeat(64);
  assert.equal((await admin(base, 'import', invalid)).status, 400);
  const imported = ok(await admin(base, 'import', snapshot), 'import');
  assert.ok(compareManifests(snapshot.manifest, imported.data).equal);
  assert.ok(compareManifests(snapshot.manifest, ok(await admin(base, 'manifest'), 'target manifest').data).equal);
  assert.equal((await admin(base, 'import', snapshot)).status, 409);
  const importedState = ok(await call(base, 'state', undefined, cookie), 'imported session').data;
  assert.equal(importedState.notifications.push.publicKey, before.notifications.push.publicKey);
  assert.deepEqual(importedState.tasks, before.tasks);
  assert.deepEqual(Buffer.from(await (await fetch(base + photoUrl, { headers: { Cookie: cookie } })).arrayBuffer()), Buffer.from(image, 'base64'));
  base = await start('target', false);
  assert.equal((await admin(base, 'manifest')).status, 404);
  const login = ok(await call(base, 'login', { email: setup.email, password: setup.password }), 'existing password');
  assert.deepEqual(login.data.tasks, before.tasks);
  ok(await call(base, 'login', { email: 'bruno@worker.test', password: 'Senha Bruno 2026!' }), 'member password');
  assert.equal(ok(await call(base, 'state', undefined, cookie), 'persisted state').data.user.id, adminId);
  console.log('OK workerd: backup integral, hashes das 13 tabelas, importação atômica, VAPID original, fotos e senhas após reinício.');

  // Provision only the new account in the imported disposable household.
  // The password is generated for this test and never comes from the workspace.
  const bootstrapPassword = randomBytes(32).toString('base64url');
  const bootstrapSalt = randomBytes(16).toString('hex');
  const bootstrap = JSON.stringify({ salt: bootstrapSalt, digest: scryptSync(bootstrapPassword, bootstrapSalt, 64).toString('hex') });
  base = await start('target', false, bootstrap);
  const beforeAdminLogin = ok(await call(base, 'state', undefined, cookie), 'bootstrap before internal provisioning').data;
  assert.deepEqual(beforeAdminLogin.users, login.data.users);
  assert.equal(beforeAdminLogin.users.some(user => user.id === 'admin'), false);
  assert.deepEqual(beforeAdminLogin.tasks, before.tasks);
  const provisioned = ok(await call(base, 'login', { email: 'admin', password: bootstrapPassword }), 'bootstrap admin login');
  assert.equal(provisioned.data.user.id, 'admin');
  assert.equal(provisioned.data.user.role, 'admin');
  assert.match(provisioned.cookie, /^casa_session=/);
  assert.match(provisioned.headers.get('Set-Cookie'), /HttpOnly.*SameSite=Strict/);
  assert.equal(provisioned.data.users.length, login.data.users.length + 1);
  assert.deepEqual(provisioned.data.users.filter(user => user.id !== 'admin'), login.data.users);
  assert.deepEqual(provisioned.data.tasks, before.tasks);
  assert.equal((await call(base, 'login', { email: 'admin', password: randomBytes(32).toString('base64url') })).status, 401);
  ok(await call(base, 'export', undefined, provisioned.cookie), 'bootstrap admin export');

  base = await start('target', false);
  const persistedAdmin = ok(await call(base, 'login', { email: 'admin', password: bootstrapPassword }), 'admin after removing bootstrap');
  assert.equal(persistedAdmin.data.user.id, 'admin');
  assert.equal(persistedAdmin.data.user.role, 'admin');
  assert.equal(persistedAdmin.data.users.length, login.data.users.length + 1);
  assert.deepEqual(persistedAdmin.data.tasks, before.tasks);
  const founderAfterBootstrap = ok(await call(base, 'login', { email: setup.email, password: setup.password }), 'founder after bootstrap');
  assert.equal(founderAfterBootstrap.data.user.id, adminId);
  assert.deepEqual(founderAfterBootstrap.data.tasks, before.tasks);
  const memberAfterBootstrap = ok(await call(base, 'login', { email: 'bruno@worker.test', password: 'Senha Bruno 2026!' }), 'member after bootstrap');
  assert.equal(memberAfterBootstrap.data.user.id, memberId);

  if (process.argv.includes('--browser')) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, channel: process.env.CASA_BROWSER_CHANNEL || 'chrome' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const loginInput = page.locator('input[name=email]');
    assert.equal(await loginInput.getAttribute('type'), 'text');
    await loginInput.fill('admin');
    await page.locator('input[name=password]').fill(bootstrapPassword);
    await page.locator('form button[type=submit]').click();
    await page.getByRole('heading', { name: 'Tudo em dia, casa leve.' }).waitFor();
    await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('button', { name: 'Moradores', exact: true }).click();
    const addResident = page.getByRole('button', { name: 'Adicionar morador', exact: true });
    assert.equal(await addResident.isVisible(), true);
    assert.equal(await addResident.isEnabled(), true);
    assert.deepEqual(errors, []);
    await browser.close(); browser = null;
  }
  console.log('OK workerd: admin provisionado uma única vez, permissões de administração e login persistente sem bootstrap, preservando moradores e tarefas.');
} finally {
  await browser?.close();
  await stop();
  const checked = resolve(temporary);
  if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('casa-cloudflare-test-')) throw new Error('Diretório temporário fora do escopo esperado.');
  rmSync(checked, { recursive: true, force: true, maxRetries: 3 });
}
