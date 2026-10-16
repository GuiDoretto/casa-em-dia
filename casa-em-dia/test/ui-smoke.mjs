import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep, basename } from 'node:path';
import { chromium } from 'playwright';
import { localNow } from '../rules.mjs';
import { addDay, monday } from '../lib/client.mjs';

// Uses a disposable database. It never connects to the household's .data directory.
const root = resolve(import.meta.dirname, '..');
const dataDir = mkdtempSync(join(tmpdir(), 'casa-ui-'));
const artifacts = resolve(root, 'work', 'ui-check');
mkdirSync(artifacts, { recursive: true });
let server, browser;
const errors = [];
async function start() {
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', CASA_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  return new Promise((yes, no) => {
    let log = '', stderr = '';
    const timer = setTimeout(() => no(new Error('Servidor não iniciou em 60 segundos. ' + stderr)), 60000);
    server.stderr.on('data', chunk => { stderr += chunk; });
    server.once('error', error => { clearTimeout(timer); no(error); });
    server.once('exit', code => { clearTimeout(timer); no(new Error('Servidor encerrou: ' + code + ' ' + stderr)); });
    server.stdout.on('data', chunk => {
      log += chunk;
      const port = log.match(/Casa em Dia · http:\/\/localhost:(\d+)/)?.[1];
      const setupToken = log.match(/configurar=([a-f0-9]+)/)?.[1];
      if (port && setupToken) { clearTimeout(timer); yes({ base: 'http://127.0.0.1:' + port, setupToken }); }
    });
  });
}
try {
  const { base, setupToken } = await start();
  browser = await chromium.launch({ headless: true, channel: process.env.CASA_BROWSER_CHANNEL || 'chrome' });
  const admin = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  const page = await admin.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?configurar=' + setupToken);
  await page.locator('input[name=houseName]').fill('República de teste');
  await page.locator('input[name=name]').fill('Ana Admin');
  await page.locator('input[name=email]').fill('ana@exemplo.test');
  await page.locator('input[name=password]').fill('Senha de teste 2026!');
  await page.locator('form button[type=submit]').click();
  await page.getByRole('heading', { name: 'Tudo em dia, casa leve.' }).waitFor();
  const nav = title => page.getByRole('navigation', { name: 'Menu principal' }).getByRole('button', { name: title, exact: true }).click();
  await nav('Administração');
  await page.locator('input[name=autoGenerate]').uncheck();
  await page.locator('input[name=skipHolidays]').uncheck();
  for (const day of ['Dom', 'Sáb']) {
    const button = page.getByRole('button', { name: 'Folga: ' + day, exact: true });
    if (await button.getAttribute('aria-pressed') === 'true') await button.click();
  }
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Salvar configurações', exact: true }).click()]);
  // Choose an activity icon, including keyboard navigation and persistence after reload.
  await page.getByRole('button', { name: 'Editar Cuidar da sala', exact: true }).click();
  const iconDialog = page.getByRole('dialog');
  assert.equal(await iconDialog.getByRole('radio').count(), 12);
  await iconDialog.getByText('Vassoura', { exact: true }).click();
  const broomRadio = iconDialog.getByRole('radio', { name: 'Vassoura', exact: true });
  assert.ok(await broomRadio.isChecked());
  await broomRadio.focus(); await broomRadio.press('ArrowRight');
  assert.ok(await iconDialog.getByRole('radio', { name: 'Banheiro', exact: true }).isChecked());
  await iconDialog.getByText('Vassoura', { exact: true }).click();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Seletor de ícones em ' + width);
    await page.screenshot({ path: join(artifacts, 'icones-' + width + '.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/save-template')), iconDialog.getByRole('button', { name: 'Salvar atividade', exact: true }).click()]);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.template-row').filter({ hasText: 'Cuidar da sala' }).locator('svg.lucide-broom').count(), 1);
  await page.reload();
  await page.getByRole('button', { name: 'Editar Cuidar da sala', exact: true }).click();
  assert.ok(await page.getByRole('dialog').getByRole('radio', { name: 'Vassoura', exact: true }).isChecked());
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();

  await nav('Moradores');
  await page.getByRole('button', { name: 'Adicionar morador', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('input[name=name]').fill('Bruno Morador');
  await dialog.locator('input[name=email]').fill('bruno@exemplo.test');
  await dialog.getByRole('button', { name: 'Cadastrar e criar convite', exact: true }).click();
  await page.getByRole('heading', { name: 'Convite pronto para compartilhar' }).waitFor();
  const invite = await page.getByRole('dialog').locator('input[readonly]').inputValue();
  assert.ok(invite.startsWith(base + '/?token='));
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  const member = await browser.newContext({ baseURL: base });
  const memberPage = await member.newPage();
  memberPage.on('pageerror', error => errors.push(error.message));
  await memberPage.goto(invite.replace('/?token=', '/convite?token='));
  await memberPage.locator('input[name=password]').fill('Senha Bruno 2026!');
  if (await memberPage.locator('input[name=confirmPassword]').count()) await memberPage.locator('input[name=confirmPassword]').fill('Senha Bruno 2026!');
  await memberPage.locator('form button[type=submit]').click();
  await memberPage.getByRole('heading', { name: 'Tudo em dia, casa leve.' }).waitFor();
  await memberPage.getByRole('button', { name: 'Abrir meu perfil', exact: true }).click();
  await memberPage.getByRole('dialog').getByRole('button', { name: 'Sair da minha conta', exact: true }).click();
  await memberPage.locator('input[name=email]').fill('bruno@exemplo.test');
  await memberPage.locator('input[name=password]').fill('Senha Bruno 2026!');
  await memberPage.locator('form button[type=submit]').click();
  await memberPage.getByRole('heading', { name: 'Tudo em dia, casa leve.' }).waitFor();
  assert.equal(await memberPage.getByRole('button', { name: 'Administração', exact: true }).count(), 0);
  const forbidden = await member.request.post('/api/reset-calendar', { headers: { Origin: base }, data: { confirmation: 'ZERAR CALENDÁRIO' } });
  assert.equal(forbidden.status(), 403);
  await nav('Sorteador');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/draw')), page.getByRole('button', { name: 'Sortear atividades', exact: true }).click()]);
  let state = await (await admin.request.get('/api/state')).json();
  assert.equal(state.tasks.length, 4);
  const inheritedIconTask = state.tasks.find(task => task.title === 'Cuidar da sala');
  assert.equal(inheritedIconTask.icon, 'broom');
  await nav('Hoje');
  await page.getByRole('button', { name: 'Editar Cuidar da sala', exact: true }).click();
  await page.getByRole('dialog').getByText('Limpeza', { exact: true }).click();
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/save-task')), page.getByRole('dialog').getByRole('button', { name: 'Salvar atividade', exact: true }).click()]);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.task-card').filter({ hasText: 'Cuidar da sala' }).locator('svg.lucide-bubbles').count(), 1);
  state = await (await admin.request.get('/api/state')).json();
  assert.equal(state.tasks.find(task => task.id === inheritedIconTask.id).icon, 'cleaning');
  assert.equal(state.templates.find(template => template.title === 'Cuidar da sala').icon, 'broom');

  await nav('Hoje');
  const complete = page.getByRole('button', { name: 'Concluir', exact: true }).first();
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/complete')), complete.click()]);
  state = await (await admin.request.get('/api/state')).json();
  assert.equal(state.tasks.filter(t => t.status === 'done').length, 1);

  for (const screen of ['Hoje', 'Agenda', 'Sorteador', 'Trocas', 'Moradores', 'Ranking', 'Administração']) {
    await page.setViewportSize({ width: 1440, height: 1000 }); await nav(screen);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, screen + ' tem rolagem horizontal em ' + width + 'px');
      if (screen === 'Hoje' && [390, 1440].includes(width)) await page.screenshot({ path: join(artifacts, 'rotina-' + width + '.png'), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Zerar todo o calendário', exact: true }).click();
  dialog = page.getByRole('dialog');
  const resetButton = dialog.getByRole('button', { name: 'Zerar todo o calendário', exact: true });
  assert.ok(await resetButton.isDisabled());
  await dialog.locator('input[name=confirmation]').fill('ZERAR CALENDÁRIO');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/reset-calendar')), resetButton.click()]);
  state = await (await admin.request.get('/api/state')).json();
  assert.equal(state.tasks.length, 0); assert.equal(state.swaps.length, 0); assert.equal(state.settings.autoGenerate, false);
  assert.equal(state.users.length, 2); assert.equal(state.templates.length, 4);
  await nav('Sorteador');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/draw')), page.getByRole('button', { name: 'Sortear atividades', exact: true }).click()]);
  state = await (await admin.request.get('/api/state')).json();
  assert.equal(state.tasks.length, 4);
  assert.equal(state.tasks.every(task => task.due_date === localNow().date && task.points === 0), true);
  await page.reload();
  await page.getByRole('heading', { name: 'Dividir para cuidar' }).waitFor();
  // Configure exactly two Monday activities and one Tuesday activity, then apply limits.
  const dayNames = [['Seg', 'Segunda-feira'], ['Ter', 'Terça-feira'], ['Qua', 'Quarta-feira'], ['Qui', 'Quinta-feira'], ['Sex', 'Sexta-feira'], ['Sáb', 'Sábado'], ['Dom', 'Domingo']];
  async function chooseDays(dialog, selectedDays) {
    const group = dialog.getByRole('group', { name: 'Dias desta atividade', exact: true });
    for (const [short, full] of dayNames) {
      const input = group.getByRole('checkbox', { name: full, exact: true });
      if (await input.isChecked() !== selectedDays.includes(short)) await group.getByText(short, { exact: true }).click();
    }
  }
  async function saveTemplate(dialog) {
    const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/save-template')), dialog.getByRole('button', { name: 'Salvar atividade', exact: true }).click()]);
    assert.equal(response.status(), 200); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await nav('Administração');
  for (const [title, days, active] of [['Limpar a cozinha', ['Seg'], true], ['Recolher o lixo', ['Seg'], true], ['Cuidar da sala', ['Qua'], false], ['Limpar o banheiro', ['Qui'], false]]) {
    await page.getByRole('button', { name: 'Editar ' + title, exact: true }).click();
    const editor = page.getByRole('dialog'); await chooseDays(editor, days);
    await editor.locator('input[name=active]').setChecked(active); await saveTemplate(editor);
  }
  await page.getByRole('button', { name: 'Adicionar atividade recorrente', exact: true }).click();
  const garageEditor = page.getByRole('dialog');
  await garageEditor.locator('input[name=title]').fill('Limpar garagem');
  await garageEditor.locator('input[name=area]').fill('Garagem');
  await garageEditor.getByText('Vassoura', { exact: true }).click();
  await chooseDays(garageEditor, ['Ter']); await saveTemplate(garageEditor);
  await page.locator('select[name=drawPeriod]').selectOption('weekly');
  await page.locator('input[name=drawCount]').fill('3');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/settings')), page.getByRole('button', { name: 'Salvar configurações', exact: true }).click()]);
  await page.reload(); await page.locator('select[name=drawPeriod]').waitFor();
  assert.equal(await page.locator('select[name=drawPeriod]').inputValue(), 'weekly');
  assert.equal(await page.locator('input[name=drawCount]').inputValue(), '3');
  await page.screenshot({ path: join(artifacts, 'limite-semanal.png'), fullPage: true });
  const nextMonday = addDay(monday(localNow().date), 7);
  await nav('Sorteador'); await page.locator('input[name=date]').fill(nextMonday);
  await page.locator('select[name=drawRange]').selectOption('week');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/draw')), page.getByRole('button', { name: 'Sortear atividades', exact: true }).click()]);
  state = await (await admin.request.get('/api/state')).json();
  const firstWeek = state.tasks.filter(task => task.due_date >= nextMonday && task.due_date <= addDay(nextMonday, 6));
  assert.equal(firstWeek.length, 3);
  assert.deepEqual(firstWeek.filter(task => task.due_date === nextMonday).map(task => task.title).sort(), ['Limpar a cozinha', 'Recolher o lixo']);
  assert.equal(firstWeek.find(task => task.title === 'Limpar garagem').due_date, addDay(nextMonday, 1));
  const [repeatResponse] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/draw')), page.getByRole('button', { name: 'Sortear atividades', exact: true }).click()]);
  assert.equal((await repeatResponse.json()).created.length, 0);
  await nav('Administração');
  await page.locator('select[name=drawPeriod]').selectOption('daily'); await page.locator('input[name=drawCount]').fill('1');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/settings')), page.getByRole('button', { name: 'Salvar configurações', exact: true }).click()]);
  const secondMonday = addDay(nextMonday, 7);
  await nav('Sorteador'); await page.locator('input[name=date]').fill(secondMonday); await page.locator('select[name=drawRange]').selectOption('week');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/draw')), page.getByRole('button', { name: 'Sortear atividades', exact: true }).click()]);
  state = await (await admin.request.get('/api/state')).json();
  assert.equal(state.tasks.filter(task => task.due_date === secondMonday).length, 1);
  assert.equal(state.tasks.filter(task => task.due_date === addDay(secondMonday, 1)).length, 1);
  assert.equal(state.tasks.filter(task => task.due_date >= secondMonday && task.due_date <= addDay(secondMonday, 6)).length, 2);

  // Upload a real image as a member, replace it as admin, and remove it as its owner.
  const photoBytes = Buffer.from(await memberPage.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d'); context.fillStyle = '#93ac67'; context.fillRect(0, 0, 16, 16);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await memberPage.getByRole('button', { name: 'Abrir meu perfil', exact: true }).click();
  let photoDialog = memberPage.getByRole('dialog');
  await photoDialog.getByLabel('Escolher foto do perfil', { exact: true }).setInputFiles({ name: 'perfil.png', mimeType: 'image/png', buffer: photoBytes });
  const [uploadResponse] = await Promise.all([memberPage.waitForResponse(r => r.url().endsWith('/api/profile-photo') && r.request().method() === 'POST'), photoDialog.getByRole('button', { name: 'Salvar foto', exact: true }).click()]);
  assert.equal(uploadResponse.status(), 200);
  const memberState = await (await member.request.get('/api/state')).json();
  const originalPhotoUrl = memberState.user.photo_url;
  assert.ok(originalPhotoUrl.startsWith('/api/profile-photo?id='));
  const imageResponse = await member.request.get(originalPhotoUrl);
  assert.equal(imageResponse.status(), 200); assert.equal(imageResponse.headers()['content-type'], 'image/jpeg');
  await memberPage.reload();
  await memberPage.waitForFunction(() => { const image = document.querySelector('.avatar-button img'); return image?.complete && image.naturalWidth > 0; });
  assert.equal(await memberPage.locator('.avatar-button img').getAttribute('src'), originalPhotoUrl);
  const unauthenticated = await browser.newContext({ baseURL: base });
  assert.equal((await unauthenticated.request.get(originalPhotoUrl)).status(), 401); await unauthenticated.close();
  await page.reload(); await nav('Moradores');
  await page.locator('.person-card').filter({ hasText: 'Bruno Morador' }).getByRole('button', { name: 'Editar', exact: true }).click();
  photoDialog = page.getByRole('dialog');
  await photoDialog.getByLabel('Escolher foto do perfil', { exact: true }).setInputFiles({ name: 'outro-perfil.png', mimeType: 'image/png', buffer: photoBytes });
  const [adminPhotoResponse] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/profile-photo') && r.request().method() === 'POST'), photoDialog.getByRole('button', { name: 'Salvar foto', exact: true }).click()]);
  assert.equal(adminPhotoResponse.status(), 200);
  state = await (await member.request.get('/api/state')).json(); assert.notEqual(state.user.photo_url, originalPhotoUrl);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Editor de foto em ' + width);
    if (width === 390) await page.screenshot({ path: join(artifacts, 'foto-perfil-390.png'), fullPage: true });
  }
  await memberPage.reload();
  await memberPage.getByRole('button', { name: 'Abrir meu perfil', exact: true }).click();
  const [removedPhotoResponse] = await Promise.all([memberPage.waitForResponse(r => r.url().endsWith('/api/profile-photo') && r.request().method() === 'POST'), memberPage.getByRole('dialog').getByRole('button', { name: 'Remover foto', exact: true }).click()]);
  assert.equal(removedPhotoResponse.status(), 200);
  state = await (await member.request.get('/api/state')).json(); assert.equal(state.user.photo_url, null);
  assert.equal((await member.request.get(originalPhotoUrl)).status(), 404);

  assert.deepEqual(errors, [], 'Erros no navegador');
  console.log('OK: login/sessão, convite real, permissão de morador, configurações, sorteio, conclusão, reset e novo sorteio.');
  console.log('OK: sete telas em 320, 390, 768 e 1440px, sem rolagem horizontal nem erros JavaScript.');
  console.log('OK: limites diário/semanal, dias por atividade, foto própria/admin, privacidade e remoção.');
  console.log('OK: ícones por teclado, seleção em celular, persistência, herança no sorteio e edição individual. Capturas em work/ui-check/.');
} finally {
  await browser?.close();
  if (server?.exitCode === null && !server.signalCode) {
    await new Promise(done => { const timer = setTimeout(done, 10000); server.once('exit', () => { clearTimeout(timer); done(); }); server.kill('SIGTERM'); });
  }
  if ((server?.exitCode !== null || server?.signalCode) && resolve(dataDir).startsWith(resolve(tmpdir()) + sep) && basename(dataDir).startsWith('casa-ui-')) {
    rmSync(dataDir, { recursive: true, force: true });
  }
}
