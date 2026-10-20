import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHouseApplication } from '../application.mjs';

function call(app, path, data, extraHeaders = {}) {
  const headers = new Map();
  const req = {
    method: data === undefined ? 'GET' : 'POST',
    url: '/api/' + path,
    headers: { host: 'agenda.example.test', origin: 'https://agenda.example.test', ...extraHeaders },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (data !== undefined) yield JSON.stringify(data); },
  };
  return app.api(req, { setHeader: (name, value) => headers.set(name.toLowerCase(), value) }, '/api/' + path)
    .then(data => ({ data, headers }));
}

const setup = { houseName: 'Casa compartilhada', name: 'Ana', email: 'ana@example.test', password: 'Senha segura para teste!' };

test('núcleo reutilizável respeita a transação do host e reverte um cadastro parcial', async t => {
  const db = new DatabaseSync(':memory:');
  let transactions = 0;
  const app = createHouseApplication({
    db, env: {}, setupToken: 'setup-test',
    transaction(fn) {
      transactions++;
      db.exec('SAVEPOINT application_test');
      try { const result = fn(); db.exec('RELEASE application_test'); return result; }
      catch (error) { db.exec('ROLLBACK TO application_test; RELEASE application_test'); throw error; }
    },
  });
  t.after(async () => { await app.notifications.stop(); db.close(); });
  await assert.rejects(call(app, 'setup', { ...setup, houseName: '' }, { 'x-setup-token': 'setup-test' }), { status: 400 });
  assert.equal(app.configured(), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM settings').get().n, 0);
  const initial = await call(app, 'setup', setup, { 'x-setup-token': 'setup-test' });
  assert.equal(transactions, 2);
  assert.equal(initial.data.user.role, 'admin');
  assert.equal(initial.data.templates.length, 4);
  assert.equal(app.configured(), true);
});

test('token de configuração vazio mantém o cadastro inicial fechado', async t => {
  const db = new DatabaseSync(':memory:');
  const app = createHouseApplication({ db, env: {}, setupToken: '' });
  t.after(async () => { await app.notifications.stop(); db.close(); });
  await assert.rejects(call(app, 'setup', setup, { 'x-setup-token': '' }), { status: 403 });
  await assert.rejects(call(app, 'setup', setup), { status: 403 });
  assert.equal(app.configured(), false);
});

test('núcleo usa o ambiente e transporte de notificações fornecidos pelo host', async t => {
  const db = new DatabaseSync(':memory:');
  const sent = [];
  const app = createHouseApplication({
    db, setupToken: 'setup-test',
    env: { CASA_TRUST_PROXY: '1', CASA_PUBLIC_URL: 'https://agenda.example.test/', BREVO_API_KEY: 'fake-test-key', BREVO_FROM_EMAIL: 'noreply@example.test' },
    notificationOptions: { fetchImpl: async (url, options) => { sent.push({ url, options }); return new Response(null, { status: 201 }); } },
  });
  t.after(async () => { await app.notifications.stop(); db.close(); });
  const initial = await call(app, 'setup', setup, { 'x-setup-token': 'setup-test', 'x-forwarded-proto': 'https' });
  const cookie = initial.headers.get('set-cookie');
  assert.match(cookie, /; Secure$/);
  assert.equal(initial.data.notifications.email.configured, true);
  const result = await call(app, 'notification-test', { channel: 'email' }, { cookie: cookie.split(';')[0] });
  assert.equal(result.data.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(JSON.parse(sent[0].options.body).to[0].email, setup.email);
});

test('limitador do host recebe a requisição e bloqueia login antes de consultar a senha', async t => {
  const storage = new DatabaseSync(':memory:');
  let loginLookups = 0;
  const db = {
    exec: (...args) => storage.exec(...args),
    prepare(sql) {
      if (sql === 'SELECT * FROM users WHERE email=? AND active=1') loginLookups++;
      return storage.prepare(sql);
    },
  };
  const limited = [];
  const app = createHouseApplication({
    db, env: {}, setupToken: '',
    rateLimit(req, label, max) {
      limited.push({ req, label, max });
      throw Object.assign(new Error('Limite persistente atingido.'), { status: 429 });
    },
  });
  t.after(async () => { await app.notifications.stop(); storage.close(); });
  await assert.rejects(call(app, 'login', { email: setup.email, password: setup.password }), { status: 429 });
  assert.equal(loginLookups, 0);
  assert.equal(limited.length, 1);
  assert.equal(limited[0].label, 'login');
  assert.equal(limited[0].max, 12);
  assert.equal(limited[0].req.method, 'POST');
  assert.equal(limited[0].req.headers.origin, 'https://agenda.example.test');
  await assert.rejects(call(app, 'invite-info'), { status: 429 });
  assert.equal(limited[1].label, 'invite-info');
  assert.equal(limited[1].max, 60);
});
