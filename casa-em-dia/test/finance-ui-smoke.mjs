import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep, basename } from 'node:path';
import { chromium } from 'playwright';
import { money } from '../finances.mjs';

// Uses only a disposable database; every account, room and bill below is a fixture.
const root = resolve(import.meta.dirname, '..');
const dataDir = mkdtempSync(join(tmpdir(), 'casa-finance-ui-'));
const artifacts = resolve(root, 'work', 'finance-ui-check');
mkdirSync(artifacts, { recursive: true });
let server, browser, page;
const errors = [];
let navigation = 0;
// A distinct document navigation exercises the app's persisted initial view;
// changing only the fragment leaves React's current navigation state in place.
async function openView(target, view) { await target.goto('/?ui-check=' + (++navigation) + '#' + view); }
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
function watchErrors(target) { target.on('pageerror', error => errors.push(error.message)); }
async function noOverflow(target, label) {
  assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label);
}
async function submit(target, path, button) {
  const [response] = await Promise.all([
    target.waitForResponse(response => response.url().endsWith('/api/' + path) && response.request().method() === 'POST'),
    button.click(),
  ]);
  assert.equal(response.status(), 200, path + ': ' + await response.text());
  return response.json();
}
try {
  const { base, setupToken } = await start();
  browser = await chromium.launch({ headless: true, channel: process.env.CASA_BROWSER_CHANNEL || 'chrome' });
  const admin = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  async function post(context, path, data) {
    const response = await context.request.post('/api/' + path, { headers: { Origin: base }, data });
    assert.equal(response.status(), 200, path + ': ' + await response.text());
    return response.json();
  }
  const setupResponse = await admin.request.post('/api/setup', { headers: { Origin: base, 'X-Setup-Token': setupToken }, data: { houseName: 'Casa dos quartos de teste', name: 'Admin Teste', email: 'admin@example.test', password: 'Senha de teste da casa 2026!' } });
  assert.equal(setupResponse.status(), 200);
  const setup = await setupResponse.json();
  await post(admin, 'settings', { ...setup.settings, autoGenerate: false, disabledDays: [], skipHolidays: false });
  async function member(name, email, phone) {
    const invitation = await post(admin, 'save-user', { name, email, phone });
    const context = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 1000 } });
    const accepted = await post(context, 'accept-invite', { token: invitation.inviteToken, password: 'Senha da moradora de teste 2026!' });
    return { context, user: accepted.user };
  }
  const alice = await member('Alice Quinta', 'alice@example.test', '11999990001');
  const beatriz = await member('Beatriz Sexta', 'beatriz@example.test', '11999990002');
  page = await admin.newPage(); watchErrors(page);
  await openView(page, 'rooms');
  async function createRoom(number, rent, resident = '', suffix = '') {
    await page.getByRole('button', { name: 'Cadastrar quarto', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[name=name]').fill('Quarto ' + number + suffix);
    await dialog.locator('[name=rent]').fill(rent);
    await dialog.locator('[name=features]').fill(number === 1 ? 'Suíte mobiliada, com banheiro privativo e janela para o jardim.' : 'Quarto ventilado com armário e espaço para estudar.');
    await dialog.locator('[name=resident_id]').selectOption(resident);
    const result = await submit(page, 'room-save', dialog.getByRole('button', { name: 'Cadastrar quarto', exact: true }));
    await dialog.waitFor({ state: 'hidden' });
    return result;
  }
  await createRoom(1, '850,00', alice.user.id, ' — suíte');
  await createRoom(2, '1050,00', beatriz.user.id, ' — varanda');
  await createRoom(3, '700,00');
  await createRoom(4, '720,00');
  await createRoom(5, '730,00', '', ' provisório');
  assert.equal(await page.locator('.rf-room-card').count(), 5);
  assert.equal(await page.locator('.rf-room-card').filter({ hasText: 'Ocupado' }).count(), 2);
  assert.equal(await page.locator('.rf-room-card').filter({ hasText: 'Disponível' }).count(), 3);
  assert.equal(await page.locator('.rf-room-card').filter({ hasText: 'Alice Quinta' }).getByRole('button', { name: /^Excluir/ }).count(), 0, 'Quarto ocupado não oferece exclusão');
  await page.getByRole('button', { name: 'Ocupados', exact: true }).click();
  assert.equal(await page.locator('.rf-room-card').count(), 2);
  await page.getByRole('button', { name: 'Disponíveis', exact: true }).click();
  assert.equal(await page.locator('.rf-room-card').count(), 3);
  let card = page.locator('.rf-room-card').filter({ hasText: 'Quarto 5 provisório' });
  await card.getByRole('button', { name: /^Editar/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('[name=name]').fill('Quarto 5 — jardim');
  await dialog.locator('[name=rent]').fill('750,00');
  assert.equal(await dialog.locator('[name=resident_id] option').filter({ hasText: 'Alice Quinta' }).count(), 0, 'Um morador não ocupa dois quartos');
  await submit(page, 'room-save', dialog.getByRole('button', { name: 'Salvar quarto', exact: true }));
  await dialog.waitFor({ state: 'hidden' });
  card = page.locator('.rf-room-card').filter({ hasText: 'Quarto 5 — jardim' });
  assert.ok((await card.textContent()).includes(money(75000)));
  await card.getByRole('button', { name: /^Excluir/ }).click();
  dialog = page.getByRole('dialog');
  await submit(page, 'room-delete', dialog.getByRole('button', { name: 'Excluir', exact: true }));
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.rf-room-card').count(), 2);
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  assert.equal(await page.locator('.rf-room-card').count(), 4);
  await createRoom(5, '750,00', '', ' — jardim');
  assert.equal(await page.locator('.rf-room-card').count(), 5);

  await openView(page, 'finances');
  await page.getByRole('heading', { name: 'Fechamento mensal', exact: true }).waitFor();
  await page.locator('[name=finance-month]').fill('2026-10');
  async function expense(description, amount) {
    await page.getByRole('button', { name: 'Adicionar despesa', exact: true }).click();
    const form = page.getByRole('dialog');
    await form.locator('[name=description]').fill(description);
    await form.locator('[name=amount]').fill(amount);
    const result = await submit(page, 'expense-save', form.getByRole('button', { name: 'Salvar despesa', exact: true }));
    await form.waitFor({ state: 'hidden' });
    return result;
  }
  await expense('Energia elétrica', '90,01');
  await expense('Água', '60,00');
  await expense('Conta provisória', '10,00');
  await page.getByRole('button', { name: 'Editar despesa: Energia elétrica', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('[name=amount]').fill('100,01');
  await submit(page, 'expense-save', dialog.getByRole('button', { name: 'Salvar despesa', exact: true }));
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Excluir despesa: Conta provisória', exact: true }).click();
  dialog = page.getByRole('dialog');
  await submit(page, 'expense-delete', dialog.getByRole('button', { name: 'Excluir', exact: true }));
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.rf-expense-list>li').count(), 2);
  assert.equal(await page.locator('.rf-preview-table tbody tr').count(), 2);
  const preview = page.locator('.rf-preview-table');
  assert.ok((await preview.textContent()).includes('Alice Quinta'));
  assert.ok((await preview.textContent()).includes('Beatriz Sexta'));
  assert.equal(await preview.locator('tfoot td').nth(0).textContent(), money(190000));
  assert.equal(await preview.locator('tfoot td').nth(1).textContent(), money(16001));
  assert.equal(await preview.locator('tfoot td').nth(2).textContent(), money(206001));
  assert.ok((await page.locator('.rf-notice').first().textContent()).includes('Admin Teste'), 'Morador ativo sem quarto fica fora do rateio');
  let state = await submit(page, 'bills-generate', page.getByRole('button', { name: 'Gerar demonstrativos', exact: true }));
  await page.locator('.rf-bill-card').first().waitFor();
  assert.equal(state.bills.length, 2);
  assert.deepEqual(state.bills.map(bill => bill.shared_cents).sort(), [8000, 8001]);
  assert.equal(state.bills.reduce((sum, bill) => sum + bill.total_cents, 0), 206001);
  assert.equal(await page.locator('.rf-bill-card').count(), 2);
  for (const [owner, other, ownRent, otherRent] of [[alice, beatriz, 85000, 105000], [beatriz, alice, 105000, 85000]]) {
    const bill = page.locator('.rf-bill-card').filter({ hasText: owner.user.name });
    const href = await bill.getByRole('link', { name: 'Preparar cobrança de ' + owner.user.name + ' no WhatsApp', exact: true }).getAttribute('href');
    const link = new URL(href), message = link.searchParams.get('text');
    assert.equal(link.pathname, '/55' + owner.user.phone);
    assert.ok(message.includes(owner.user.name)); assert.ok(message.includes(money(ownRent)));
    assert.ok(!message.includes(other.user.name)); assert.ok(!message.includes(money(otherRent)), 'Mensagem individual não contém aluguel alheio');
    assert.ok(message.includes('Energia elétrica')); assert.ok(message.includes('Água'));
  }
  await admin.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.locator('.rf-bill-card').filter({ hasText: alice.user.name }).getByRole('button', { name: 'Copiar cobrança', exact: true }).click();
  await page.getByText('Cobrança copiada.', { exact: true }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.includes(alice.user.name)); assert.ok(!copied.includes(beatriz.user.name));
  const generated = state.bills.map(bill => ({ id: bill.id, total_cents: bill.total_cents, generated_at: bill.generated_at }));
  await page.reload();
  await page.getByRole('heading', { name: 'Fechamento mensal', exact: true }).waitFor();
  await page.locator('[name=finance-month]').fill('2026-10');
  await page.locator('.rf-bill-card').first().waitFor();
  state = await (await admin.request.get('/api/state')).json();
  assert.deepEqual(state.bills.map(bill => ({ id: bill.id, total_cents: bill.total_cents, generated_at: bill.generated_at })), generated, 'Snapshot salvo sobrevive ao reload');
  await page.getByRole('button', { name: 'Editar despesa: Energia elétrica', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('[name=amount]').fill('100,02');
  state = await submit(page, 'expense-save', dialog.getByRole('button', { name: 'Salvar despesa', exact: true }));
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(state.bills.reduce((sum, bill) => sum + bill.shared_cents, 0), 16001, 'Editar conta preserva cobranças geradas até novo fechamento');
  await page.getByText('O cálculo atual tem alterações.', { exact: false }).waitFor();
  state = await submit(page, 'bills-generate', page.getByRole('button', { name: 'Atualizar demonstrativos', exact: true }));
  assert.equal(state.bills.reduce((sum, bill) => sum + bill.total_cents, 0), 206002);
  assert.equal(state.bills.length, 2, 'Atualizar substitui demonstrativos do mês sem duplicar');

  const memberPage = await alice.context.newPage(); watchErrors(memberPage);
  await openView(memberPage, 'finances');
  await memberPage.getByRole('heading', { name: 'Suas despesas mensais', exact: true }).waitFor();
  await memberPage.locator('[name=finance-month]').fill('2026-10');
  await memberPage.locator('.rf-bill-card').waitFor();
  assert.equal(await memberPage.locator('.rf-bill-card').count(), 1);
  assert.ok(!(await memberPage.locator('.rf-finances').textContent()).includes(beatriz.user.name));
  assert.equal(await memberPage.getByRole('button', { name: 'Adicionar despesa', exact: true }).count(), 0);
  const memberState = await (await alice.context.request.get('/api/state')).json();
  assert.equal(memberState.expenses.length, 0);
  assert.equal(memberState.bills.length, 1);
  assert.equal(memberState.bills[0].user_id, alice.user.id);
  const ownRoom = memberState.rooms.find(room => room.resident_id === alice.user.id);
  const ownExpense = state.expenses[0];
  for (const [path, data] of [['room-save', { id: ownRoom.id, name: ownRoom.name, rent: '1,00', features: '', resident_id: alice.user.id }], ['room-delete', { id: ownRoom.id }], ['expense-save', { month: '2026-10', description: 'Proibida', amount: '1,00' }], ['expense-delete', { id: ownExpense.id }], ['bills-generate', { month: '2026-10' }]]) {
    const denied = await alice.context.request.post('/api/' + path, { headers: { Origin: base }, data });
    assert.equal(denied.status(), 403, path + ' exige administrador');
  }
  await openView(memberPage, 'rooms');
  await memberPage.locator('.rf-room-card').first().waitFor();
  assert.equal(await memberPage.locator('.rf-room-card').count(), 5);
  assert.equal(await memberPage.getByRole('button', { name: 'Cadastrar quarto', exact: true }).count(), 0);
  assert.equal(await memberPage.locator('.rf-room-card button').count(), 0, 'Morador apenas consulta os quartos');
  await memberPage.close();

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await openView(page, 'rooms');
    await page.locator('.rf-room-card').first().waitFor();
    await noOverflow(page, 'Quartos em ' + width);
    await page.screenshot({ path: join(artifacts, 'quartos-' + width + '.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cadastrar quarto', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await noOverflow(page, 'Modal de quarto em ' + width);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    if (width === 390) {
      const mobileNav = page.getByRole('navigation', { name: 'Menu para celular', exact: true });
      await mobileNav.getByRole('button', { name: 'Despesas', exact: true }).click();
      await page.getByRole('heading', { name: 'Fechamento mensal', exact: true }).waitFor();
      await mobileNav.getByRole('button', { name: 'Mais', exact: true }).click();
      const more = page.getByRole('dialog', { name: 'Mais opções', exact: true });
      await more.waitFor();
      await noOverflow(page, 'Menu Mais em 390');
      await more.getByRole('button', { name: 'Quartos', exact: true }).click();
      await more.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.rf-room-card').count(), 5, 'Menu Mais abre Quartos');
      await mobileNav.getByRole('button', { name: 'Despesas', exact: true }).click();
    } else { await openView(page, 'finances'); }
    await page.getByRole('heading', { name: 'Fechamento mensal', exact: true }).waitFor();
    await page.locator('[name=finance-month]').fill('2026-10');
    await page.locator('.rf-bill-card').first().waitFor();
    await noOverflow(page, 'Finanças em ' + width);
    const summaryValues = await page.locator('.rf-overview .rf-money-value').evaluateAll(nodes => nodes.map(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      return { text: node.textContent, lines: range.getClientRects().length, fits: node.scrollWidth <= node.clientWidth + 1 };
    }));
    assert.ok(summaryValues.every(value => value.lines === 1 && value.fits), 'Resumo monetário legível em ' + width + ': ' + JSON.stringify(summaryValues));
    await page.screenshot({ path: join(artifacts, 'financas-' + width + '.png'), fullPage: true });
    await page.getByRole('button', { name: 'Adicionar despesa', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await noOverflow(page, 'Modal de despesa em ' + width);
    await page.screenshot({ path: join(artifacts, 'despesa-modal-' + width + '.png'), fullPage: true });
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  }

  const iphone = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true, storageState: await admin.storageState() });
  const iphonePage = await iphone.newPage(); watchErrors(iphonePage);
  await openView(iphonePage, 'rooms');
  const banner = iphonePage.getByRole('region', { name: 'Instalar Casa em Dia', exact: true });
  await banner.getByRole('heading', { name: 'Quer instalar o Casa em Dia?', exact: true }).waitFor();
  await banner.getByRole('button', { name: 'Como adicionar', exact: true }).click();
  await banner.getByText('Adicionar à Tela de Início', { exact: true }).waitFor();
  assert.ok((await banner.textContent()).includes('Safari'));
  for (const width of [390, 320]) {
    await iphonePage.setViewportSize({ width, height: 844 });
    await noOverflow(iphonePage, 'Banner iOS expandido em ' + width);
  }
  await iphonePage.screenshot({ path: join(artifacts, 'instalar-ios-320.png'), fullPage: true });
  await banner.getByRole('button', { name: 'Agora não', exact: true }).click();
  await banner.waitFor({ state: 'hidden' });
  await iphonePage.reload();
  await iphonePage.locator('.rf-room-card').first().waitFor();
  assert.equal(await banner.count(), 0, 'Dispensa da sugestão de instalação persiste após reload');
  await iphone.close();
  assert.deepEqual(errors, [], 'Erros JavaScript no navegador');
  rmSync(join(artifacts, 'falha.png'), { force: true });
  console.log('OK: CRUD de cinco quartos, dois ocupados com aluguéis diferentes e três vazios, filtros e ocupação única.');
  console.log('OK: despesas CRUD, rateio exato em centavos, snapshots persistidos/atualizados e WhatsApp individual.');
  console.log('OK: morador visualiza apenas o próprio demonstrativo e não altera quartos/despesas/fechamentos.');
  console.log('OK: desktop 1440px, mobile 320/390px, menu Mais/Quartos/Despesas, modais e sugestão iOS sem overflow; dispensa persistente.');
  console.log('Capturas em work/finance-ui-check/.');
} catch (failure) {
  try { await page?.screenshot({ path: join(artifacts, 'falha.png'), fullPage: true }); } catch {}
  throw failure;
} finally {
  await browser?.close();
  if (server?.exitCode === null && !server.signalCode) {
    await new Promise(done => { const timer = setTimeout(done, 10000); server.once('exit', () => { clearTimeout(timer); done(); }); server.kill('SIGTERM'); });
  }
  const target = resolve(dataDir);
  if ((server?.exitCode !== null || server?.signalCode) && target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('casa-finance-ui-')) rmSync(target, { recursive: true, force: true });
}
