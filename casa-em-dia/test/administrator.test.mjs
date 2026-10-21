import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ADMIN_USER_ID, provisionAdministrator } from '../administrator.mjs';
import { createHouseApplication } from '../application.mjs';

function createDatabase(configured = true) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT NOT NULL DEFAULT '',role TEXT NOT NULL DEFAULT 'member',active INTEGER NOT NULL DEFAULT 1,password_hash TEXT,password_salt TEXT,invite_hash TEXT,invite_expires INTEGER);
    CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
    CREATE TABLE sessions (hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE templates (id TEXT PRIMARY KEY,title TEXT NOT NULL,area TEXT NOT NULL,duration INTEGER NOT NULL,deadline TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,icon TEXT NOT NULL DEFAULT '',weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]');
  `);
  if (configured) {
    db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({ houseName: 'Casa existente', autoGenerate: false }));
    db.prepare('INSERT INTO users(id,name,email,role) VALUES(?,?,?,?)').run('founder', 'Fundadora', 'founder@example.test', 'admin');
    db.prepare('INSERT INTO users(id,name,email,role) VALUES(?,?,?,?)').run('resident', 'Morador', 'resident@example.test', 'member');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('existing-session', 'founder', 4102444800000);
    db.prepare('INSERT INTO templates(id,title,area,duration,deadline) VALUES(?,?,?,?,?)').run('existing-template', 'Limpar a sala', 'Sala', 15, '20:00');
  }
  return db;
}

function house(t, configured = true) {
  const db = createDatabase(configured);
  t.after(() => db.close());
  return db;
}

function credential() {
  const secret = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(secret, salt, 64).toString('hex');
  return { secret, salt, digest, json: JSON.stringify({ salt, digest }) };
}

function snapshot(db) {
  return Object.fromEntries(['users', 'settings', 'sessions', 'templates'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
}

test('provisiona somente o administrador reservado e preserva os dados da casa', t => {
  const db = house(t), material = credential(), before = snapshot(db);
  assert.equal(ADMIN_USER_ID, 'admin');
  assert.equal(provisionAdministrator(db, material.json), true);
  const admin = db.prepare('SELECT * FROM users WHERE id=?').get(ADMIN_USER_ID);
  assert.equal(admin.name, 'Administrador');
  assert.equal(admin.email, 'admin@casa-em-dia.invalid');
  assert.equal(admin.phone, '');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.active, 1);
  assert.equal(admin.password_salt, material.salt);
  assert.equal(admin.password_hash, material.digest);
  assert.equal(timingSafeEqual(scryptSync(material.secret, admin.password_salt, 64), Buffer.from(admin.password_hash, 'hex')), true);
  assert.equal(admin.invite_hash, null);
  assert.equal(admin.invite_expires, null);
  const after = snapshot(db);
  after.users = after.users.filter(user => user.id !== ADMIN_USER_ID);
  assert.deepEqual(after, before);
});

test('uma nova inicialização preserva senha, contatos e desativação escolhidos depois do cadastro', t => {
  const db = house(t);
  assert.equal(provisionAdministrator(db, credential().json), true);
  const updated = credential();
  db.prepare('UPDATE users SET name=?,email=?,phone=?,active=0,password_hash=?,password_salt=? WHERE id=?')
    .run('Admin atualizado', 'updated@example.test', '11999999999', updated.digest, updated.salt, ADMIN_USER_ID);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('admin-session', ADMIN_USER_ID, 4102444800000);
  const before = snapshot(db);
  assert.equal(provisionAdministrator(db, credential().json), false);
  assert.deepEqual(snapshot(db), before);
});

test('sem configuração explícita não acessa nem altera o banco', () => {
  const db = { prepare() { assert.fail('O banco não deve ser acessado sem credenciais de bootstrap.'); } };
  for (const missing of [undefined, null, '']) assert.equal(provisionAdministrator(db, missing), false);
});

test('sem uma casa configurada não cria usuários nem configurações', t => {
  const db = house(t, false), before = snapshot(db);
  assert.equal(provisionAdministrator(db, credential().json), false);
  assert.deepEqual(snapshot(db), before);
});

test('rejeita JSON ou material hexadecimal inválido sem alterar a casa', t => {
  const db = house(t), material = credential(), before = snapshot(db);
  for (const invalid of [
    'invalid-json', 'null', '[]', '{}', 'false',
    JSON.stringify({ salt: material.salt }),
    JSON.stringify({ digest: material.digest }),
    JSON.stringify({ salt: material.salt.slice(1), digest: material.digest }),
    JSON.stringify({ salt: 'g'.repeat(32), digest: material.digest }),
    JSON.stringify({ salt: material.salt, digest: material.digest.slice(1) }),
    JSON.stringify({ salt: material.salt, digest: 'g'.repeat(128) }),
    JSON.stringify({ salt: 123, digest: material.digest }),
    JSON.stringify({ salt: material.salt, digest: 123 }),
  ]) {
    assert.throws(() => provisionAdministrator(db, invalid), /CASA_ADMIN_BOOTSTRAP/);
    assert.deepEqual(snapshot(db), before);
  }
});

test('mantém o salt hexadecimal exatamente como recebido para preservar a derivação da senha', t => {
  const db = house(t), material = credential(), salt = material.salt.toUpperCase();
  const digest = scryptSync(material.secret, salt, 64).toString('hex');
  assert.equal(provisionAdministrator(db, JSON.stringify({ salt, digest })), true);
  const admin = db.prepare('SELECT * FROM users WHERE id=?').get(ADMIN_USER_ID);
  assert.equal(admin.password_salt, salt);
  assert.equal(timingSafeEqual(scryptSync(material.secret, admin.password_salt, 64), Buffer.from(admin.password_hash, 'hex')), true);
});

test('não promove nem sobrescreve uma conta que ocupa o identificador reservado', t => {
  const db = house(t);
  db.prepare('INSERT INTO users(id,name,email,role) VALUES(?,?,?,?)').run(ADMIN_USER_ID, 'Outro usuário', 'other@example.test', 'member');
  const before = snapshot(db);
  assert.throws(() => provisionAdministrator(db, credential().json), /identificador reservado admin/);
  assert.deepEqual(snapshot(db), before);
});

test('conflito de e-mail reverte o único INSERT e preserva todas as contas', t => {
  const db = house(t);
  db.prepare('UPDATE users SET email=? WHERE id=?').run('admin@casa-em-dia.invalid', 'resident');
  const before = snapshot(db);
  assert.throws(() => provisionAdministrator(db, credential().json), /UNIQUE constraint failed/);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.prepare('SELECT id FROM users WHERE id=?').get(ADMIN_USER_ID), undefined);
});

function applicationHouse(t, bootstrap = true) {
  const db = createDatabase(), material = credential();
  const app = createHouseApplication({ db, env: bootstrap ? { CASA_ADMIN_BOOTSTRAP: material.json } : {}, setupToken: '' });
  t.after(async () => { await app.notifications.stop(); db.close(); });
  return { db, app, material };
}

async function call(app, path, data, cookie = '') {
  const headers = new Map();
  const req = {
    method: data === undefined ? 'GET' : 'POST',
    url: '/api/' + path,
    headers: { host: 'casa.example.test', origin: 'https://casa.example.test', cookie },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (data !== undefined) yield JSON.stringify(data); },
  };
  const response = await app.api(req, { setHeader: (name, value) => headers.set(name.toLowerCase(), value) }, '/api/' + path);
  return { data: response, cookie: headers.get('set-cookie')?.split(';')[0] || '' };
}

test('a aplicação provisiona e aceita admin com letras maiúsculas ou espaços', async t => {
  const { app, material } = applicationHouse(t);
  for (const login of ['admin', 'ADMIN', '  AdMiN  ']) {
    const result = await call(app, 'login', { email: login, password: material.secret });
    assert.equal(result.data.user.id, ADMIN_USER_ID);
    assert.equal(result.data.user.role, 'admin');
    assert.match(result.cookie, /^casa_session=/);
    assert.equal((await call(app, 'state', undefined, result.cookie)).data.user.id, ADMIN_USER_ID);
  }
  await assert.rejects(call(app, 'login', { email: 'admin', password: randomBytes(32).toString('base64url') }), { status: 401 });
});

test('o alias não escolhe outro administrador pelo nome ou pela posição na casa', async t => {
  const { app, db, material } = applicationHouse(t, false);
  db.prepare('UPDATE users SET name=?,password_hash=?,password_salt=? WHERE id=?').run('admin', material.digest, material.salt, 'founder');
  await assert.rejects(call(app, 'login', { email: 'admin', password: material.secret }), { status: 401 });
  const founder = await call(app, 'login', { email: 'founder@example.test', password: material.secret });
  assert.equal(founder.data.user.id, 'founder');
  assert.equal(founder.data.user.role, 'admin');
});

test('o alias rejeita uma conta reservada inativa ou que perdeu o papel de administrador', async t => {
  const { app, db, material } = applicationHouse(t);
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(ADMIN_USER_ID);
  await assert.rejects(call(app, 'login', { email: 'admin', password: material.secret }), { status: 401 });
  db.prepare('UPDATE users SET active=1,role=? WHERE id=?').run('member', ADMIN_USER_ID);
  await assert.rejects(call(app, 'login', { email: 'admin', password: material.secret }), { status: 401 });
});

test('o administrador cria convites e o morador convidado não pode conceder acesso', async t => {
  const { app, db, material } = applicationHouse(t);
  const admin = await call(app, 'login', { email: 'admin', password: material.secret });
  const invitation = await call(app, 'save-user', { name: 'Pessoa convidada', email: 'invited@example.test', phone: '', active: true }, admin.cookie);
  assert.match(invitation.data.inviteToken, /^[a-f0-9]{48}$/);
  const invitedUser = invitation.data.users.find(user => user.email === 'invited@example.test');
  assert.equal(invitedUser.role, 'member');
  assert.equal(invitedUser.active, 1);
  const member = await call(app, 'accept-invite', { token: invitation.data.inviteToken, password: randomBytes(32).toString('base64url') });
  assert.equal(member.data.user.id, invitedUser.id);
  assert.equal(member.data.user.role, 'member');
  await assert.rejects(call(app, 'save-user', { name: 'Sem autorização', email: 'denied@example.test', phone: '', active: true }, member.cookie), { status: 403 });
  assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get('denied@example.test'), undefined);
});
