import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep, basename } from 'node:path';
import { chromium } from 'playwright';
import { localNow } from '../rules.mjs';

// Every account, task and session belongs to this disposable SQLite database.
const root = resolve(import.meta.dirname, '..');
const dataDir = mkdtempSync(join(tmpdir(), 'casa-resident-ui-'));
const artifacts = resolve(root, 'work', 'resident-ui-check');
mkdirSync(artifacts, { recursive: true });
let server, browser;
const errors = [];
async function start() {
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', CASA_DATA_DIR: dataDir, BREVO_API_KEY: '', BREVO_FROM_EMAIL: '', CASA_SMS_ENABLED: '0', CASA_PUBLIC_URL: '', CASA_ADMIN_BOOTSTRAP: '' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  return new Promise((yes, no) => {
    let output = '', stderr = '';
    const timer = setTimeout(() => no(new Error('Servidor não iniciou em 60 segundos. ' + stderr)), 60000);
    server.stderr.on('data', chunk => { stderr += chunk; });
    server.once('error', error => { clearTimeout(timer); no(error); });
    server.once('exit', code => { clearTimeout(timer); no(new Error('Servidor encerrou: ' + code + ' ' + stderr)); });
    server.stdout.on('data', chunk => {
      output += chunk;
      const port = output.match(/Casa em Dia · http:\/\/localhost:(\d+)/)?.[1];
      const setupToken = output.match(/configurar=([a-f0-9]+)/)?.[1];
      if (port && setupToken) { clearTimeout(timer); yes({ base: 'http://127.0.0.1:' + port, setupToken }); }
    });
  });
}
try {
  const { base, setupToken } = await start();
  browser = await chromium.launch({ headless: true, channel: process.env.CASA_BROWSER_CHANNEL || 'chrome' });
  const admin = await browser.newContext({ baseURL: base });
  async function post(context, path, data) {
    const response = await context.request.post('/api/' + path, { headers: { Origin: base }, data });
    assert.equal(response.status(), 200, path + ': ' + await response.text());
    return response.json();
  }
  const setupResponse = await admin.request.post('/api/setup', { headers: { Origin: base, 'X-Setup-Token': setupToken }, data: { houseName: 'Casa dos testes', name: 'Administradora', email: 'admin@example.test', password: 'Senha de teste da casa 2026!' } });
  assert.equal(setupResponse.status(), 200);
  const setup = await setupResponse.json();
  await post(admin, 'settings', { ...setup.settings, autoGenerate: false, disabledDays: [], skipHolidays: false });
  const day = new Date(localNow().date + 'T12:00:00Z'); day.setUTCDate(day.getUTCDate() + 2);
  const future = day.toISOString().slice(0, 10);
  for (const width of [1440, 390]) {
    const viewport = { width, height: 1000 };
    const adminPage = await admin.newPage();
    adminPage.on('pageerror', error => errors.push(error.message));
    await adminPage.setViewportSize(viewport);
    await adminPage.goto('/#people');
    await adminPage.getByRole('button', { name: 'Adicionar morador', exact: true }).click();
    let dialog = adminPage.getByRole('dialog');
    assert.equal(await dialog.locator('input[name=isAdmin]').isChecked(), false, 'Novo cadastro vem desmarcado em ' + width);
    await dialog.locator('input[name=name]').fill('Admin temporário ' + width);
    await dialog.locator('input[name=email]').fill('temporary-' + width + '@example.test');
    await dialog.locator('input[name=isAdmin]').check();
    const [createdResponse] = await Promise.all([
      adminPage.waitForResponse(response => response.url().endsWith('/api/save-user') && response.request().method() === 'POST'),
      dialog.getByRole('button', { name: 'Cadastrar e criar convite', exact: true }).click(),
    ]);
    assert.equal(createdResponse.status(), 200);
    const created = await createdResponse.json();
    assert.equal(created.users.find(user => user.email === 'temporary-' + width + '@example.test').role, 'admin');
    await adminPage.getByRole('heading', { name: 'Convite pronto para compartilhar' }).waitFor();
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
    const temporaryCard = adminPage.locator('.person-card').filter({ hasText: 'Admin temporário ' + width });
    await temporaryCard.getByRole('button', { name: 'Editar', exact: true }).click();
    dialog = adminPage.getByRole('dialog');
    assert.equal(await dialog.locator('input[name=isAdmin]').isChecked(), true);
    await dialog.locator('input[name=isAdmin]').uncheck();
    const [editedResponse] = await Promise.all([
      adminPage.waitForResponse(response => response.url().endsWith('/api/save-user') && response.request().method() === 'POST'),
      dialog.getByRole('button', { name: 'Salvar dados', exact: true }).click(),
    ]);
    assert.equal(editedResponse.status(), 200);
    await adminPage.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await editedResponse.json()).users.find(user => user.email === 'temporary-' + width + '@example.test').role, 'member');
    assert.equal(await adminPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Cadastro em ' + width);
    await adminPage.close();

    async function member(name) {
      const invitation = await post(admin, 'save-user', { name: name + ' ' + width, email: name.toLowerCase() + '-' + width + '@example.test', phone: '' });
      const context = await browser.newContext({ baseURL: base, viewport });
      const accepted = await post(context, 'accept-invite', { token: invitation.inviteToken, password: 'Senha da moradora de teste 2026!' });
      assert.equal(accepted.user.role, 'member');
      return { context, user: accepted.user };
    }
    const requester = await member('Solicitante'), recipient = await member('Destinataria'), outsider = await member('Terceira');
    async function task(title, person) {
      const result = await post(admin, 'save-task', { title: title + ' ' + width, area: 'Sala', duration: 10, due_date: future, deadline: '23:59', assignee_id: person.user.id });
      return result.tasks.find(task => task.title === title + ' ' + width);
    }
    const offered = await task('Oferta', requester), wanted = await task('Destino', recipient);
    const requesterPage = await requester.context.newPage(), recipientPage = await recipient.context.newPage();
    for (const page of [requesterPage, recipientPage]) page.on('pageerror', error => errors.push(error.message));
    await requesterPage.goto('/#swaps');
    await recipientPage.goto('/');
    await recipientPage.getByRole('heading', { name: 'Tudo em dia, casa leve.' }).waitFor();
    await requesterPage.getByRole('button', { name: 'Pedir troca', exact: true }).click();
    const swapDialog = requesterPage.getByRole('dialog');
    await swapDialog.locator('select[name=taskA]').selectOption(offered.id);
    assert.equal(await swapDialog.getByRole('button', { name: 'Enviar pedido', exact: true }).isDisabled(), true);
    await swapDialog.locator('select[name=taskB]').selectOption(wanted.id);
    assert.equal(await requesterPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Diálogo de troca em ' + width);
    const [swapResponse] = await Promise.all([
      requesterPage.waitForResponse(response => response.url().endsWith('/api/swap') && response.request().method() === 'POST'),
      swapDialog.getByRole('button', { name: 'Enviar pedido', exact: true }).click(),
    ]);
    assert.equal(swapResponse.status(), 200);
    const pending = (await swapResponse.json()).swaps.find(swap => swap.task_a === offered.id && swap.status === 'pending');
    assert.ok(pending);
    await requesterPage.getByRole('heading', { name: 'Você propôs uma troca para ' + recipient.user.name }).waitFor();
    // Simulate returning to the recipient's app so its existing refresh handler runs.
    await recipientPage.bringToFront();
    await recipientPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const bell = recipientPage.getByRole('button', { name: /^Notificações:.*1 pedidos de troca$/ });
    await bell.waitFor();
    await bell.click();
    await recipientPage.getByRole('heading', { name: 'Pedidos de troca recebidos' }).waitFor();
    await recipientPage.getByRole('dialog').getByRole('button', { name: 'Ver pedido', exact: true }).click();
    await recipientPage.getByRole('heading', { name: requester.user.name + ' propôs uma troca' }).waitFor();
    const wrongResponse = await outsider.context.request.post('/api/resolve-swap', { headers: { Origin: base }, data: { id: pending.id, action: 'accepted' } });
    assert.equal(wrongResponse.status(), 403);
    const ownResponse = await requester.context.request.post('/api/resolve-swap', { headers: { Origin: base }, data: { id: pending.id, action: 'accepted' } });
    assert.equal(ownResponse.status(), 403);
    const [acceptedResponse] = await Promise.all([
      recipientPage.waitForResponse(response => response.url().endsWith('/api/resolve-swap') && response.request().method() === 'POST'),
      recipientPage.getByRole('button', { name: 'Aceitar troca', exact: true }).click(),
    ]);
    assert.equal(acceptedResponse.status(), 200);
    const acceptedState = await acceptedResponse.json();
    assert.equal(acceptedState.tasks.find(task => task.id === offered.id).assignee_id, recipient.user.id);
    assert.equal(acceptedState.tasks.find(task => task.id === wanted.id).assignee_id, requester.user.id);
    await recipientPage.locator('.swap-card').getByText('Aceita', { exact: true }).waitFor();
    assert.equal(await recipientPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Troca recebida em ' + width);
    await recipientPage.screenshot({ path: join(artifacts, 'troca-aceita-' + width + '.png'), fullPage: true });
    await requester.context.close(); await recipient.context.close(); await outsider.context.close();
  }
  assert.deepEqual(errors, [], 'Erros JavaScript no navegador');
  console.log('OK: cadastro com admin desmarcado, promoção e edição em 1440 e 390px.');
  console.log('OK: pedido real, sino do destinatário, autorização e aceite com troca dos responsáveis em desktop/mobile.');
  console.log('OK: sem rolagem horizontal ou erros JavaScript. Capturas em work/resident-ui-check/.');
} finally {
  await browser?.close();
  if (server?.exitCode === null && !server.signalCode) {
    await new Promise(done => { const timer = setTimeout(done, 10000); server.once('exit', () => { clearTimeout(timer); done(); }); server.kill('SIGTERM'); });
  }
  const target = resolve(dataDir);
  if ((server?.exitCode !== null || server?.signalCode) && target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('casa-resident-ui-')) rmSync(target, { recursive: true, force: true });
}
