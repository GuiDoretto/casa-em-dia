import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHouseApplication } from '../application.mjs';
import { localNow } from '../rules.mjs';

async function call(app, path, data, cookie = '') {
  const headers = new Map();
  const req = {
    method: data === undefined ? 'GET' : 'POST', url: '/api/' + path,
    headers: { host: 'casa.example.test', origin: 'https://casa.example.test', cookie },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (data !== undefined) yield JSON.stringify(data); },
  };
  const response = await app.api(req, { setHeader: (name, value) => headers.set(name.toLowerCase(), value) }, '/api/' + path);
  return { data: response, cookie: headers.get('set-cookie')?.split(';')[0] || '' };
}

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const app = createHouseApplication({ db, env: {}, setupToken: 'test-setup' });
  // Configure an authenticated house through the public setup flow.
  const headers = new Map();
  const setup = { houseName: 'Casa de teste', name: 'Fundadora', email: 'founder@example.test', password: 'Senha inicial da casa 2026!' };
  const req = { method: 'POST', url: '/api/setup', headers: { host: 'casa.example.test', origin: 'https://casa.example.test', 'x-setup-token': 'test-setup' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield JSON.stringify(setup); } };
  const state = await app.api(req, { setHeader: (name, value) => headers.set(name.toLowerCase(), value) }, '/api/setup');
  const cookie = headers.get('set-cookie').split(';')[0];
  t.after(async () => { await app.notifications.stop(); db.close(); });
  await call(app, 'settings', { ...state.settings, autoGenerate: false, disabledDays: [], skipHolidays: false }, cookie);
  async function resident(name, isAdmin) {
    const invitation = await call(app, 'save-user', { name, email: name.toLowerCase() + '@example.test', phone: '', ...(isAdmin === undefined ? {} : { isAdmin }) }, cookie);
    const person = invitation.data.users.find(user => user.name === name);
    const access = await call(app, 'accept-invite', { token: invitation.data.inviteToken, password: 'Senha pessoal de teste 2026!' });
    return { ...person, cookie: access.cookie };
  }
  return { app, db, state, cookie, resident };
}

test('novos moradores começam sem administração, e somente admin pode alterar a flag', async t => {
  const { app, cookie, resident } = await fixture(t);
  const member = await resident('Moradora');
  assert.equal(member.role, 'member');
  const explicitMember = await resident('Pessoa', false);
  assert.equal(explicitMember.role, 'member');
  const promoted = await call(app, 'save-user', { id: member.id, name: member.name, email: member.email, phone: '', isAdmin: true }, cookie);
  assert.equal(promoted.data.users.find(user => user.id === member.id).role, 'admin');
  const legacyEdit = await call(app, 'save-user', { id: member.id, name: 'Nome atualizado', email: member.email, phone: '' }, cookie);
  assert.equal(legacyEdit.data.users.find(user => user.id === member.id).role, 'admin');
  await assert.rejects(call(app, 'save-user', { id: explicitMember.id, name: explicitMember.name, email: explicitMember.email, isAdmin: true }, explicitMember.cookie), { status: 403 });
  await assert.rejects(call(app, 'save-user', { name: 'Flag inválida', email: 'invalid@example.test', isAdmin: 'false' }, cookie), { status: 400 });
  const demoted = await call(app, 'save-user', { id: member.id, name: member.name, email: member.email, phone: '', isAdmin: false }, cookie);
  assert.equal(demoted.data.users.find(user => user.id === member.id).role, 'member');
  await assert.rejects(call(app, 'settings', demoted.data.settings, member.cookie), { status: 403 });
});

test('preserva administrador com acesso configurado e aplica rebaixamento à sessão atual', async t => {
  const { app, state, cookie, resident } = await fixture(t);
  const payload = { id: state.user.id, name: state.user.name, email: state.user.email, phone: '', isAdmin: false };
  await assert.rejects(call(app, 'save-user', payload, cookie), /ao menos um administrador/);
  const invitation = await call(app, 'save-user', { name: 'Admin convidado', email: 'pending@example.test', isAdmin: true }, cookie);
  assert.equal(invitation.data.users.find(user => user.email === 'pending@example.test').role, 'admin');
  await assert.rejects(call(app, 'save-user', payload, cookie), /acesso já configurado/);
  await resident('SegundaAdmin', true);
  const demoted = await call(app, 'save-user', payload, cookie);
  assert.equal(demoted.data.user.role, 'member');
  await assert.rejects(call(app, 'save-user', { ...payload, isAdmin: true }, cookie), { status: 403 });
});

test('novo pedido libera uma tarefa presa a troca expirada e mantém resposta restrita ao destinatário', async t => {
  const { app, db, cookie, resident } = await fixture(t);
  const requester = await resident('Solicitante');
  const previous = await resident('Anterior');
  const recipient = await resident('Destinataria');
  const future = new Date(localNow().date + 'T12:00:00Z'); future.setUTCDate(future.getUTCDate() + 2);
  async function task(title, owner) {
    const result = await call(app, 'save-task', { title, area: 'Sala', duration: 10, deadline: '23:59', due_date: future.toISOString().slice(0, 10), assignee_id: owner.id }, cookie);
    return result.data.tasks.find(item => item.title === title);
  }
  const a = await task('Atividade oferecida', requester), b = await task('Atividade antiga', previous), c = await task('Atividade solicitada', recipient);
  const first = await call(app, 'swap', { taskA: a.id, taskB: b.id }, requester.cookie);
  const firstId = first.data.swaps.find(swap => swap.status === 'pending').id;
  db.prepare('UPDATE tasks SET due_date=? WHERE id=?').run('2000-01-01', b.id);
  const replacement = await call(app, 'swap', { taskA: a.id, taskB: c.id }, requester.cookie);
  assert.equal(replacement.data.swaps.find(swap => swap.id === firstId).status, 'cancelled');
  const pending = replacement.data.swaps.find(swap => swap.status === 'pending');
  assert.equal(pending.recipient_id, recipient.id);
  await assert.rejects(call(app, 'resolve-swap', { id: pending.id, action: 'accepted' }, previous.cookie), { status: 403 });
  const accepted = await call(app, 'resolve-swap', { id: pending.id, action: 'accepted' }, recipient.cookie);
  assert.equal(accepted.data.tasks.find(task => task.id === a.id).assignee_id, recipient.id);
  assert.equal(accepted.data.tasks.find(task => task.id === c.id).assignee_id, requester.id);
  await assert.rejects(call(app, 'swap', { taskA: a.id }, requester.cookie), { status: 400 });
});
