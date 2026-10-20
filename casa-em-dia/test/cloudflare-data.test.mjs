import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import webpush from 'web-push';
import { createHouseApplication } from '../application.mjs';
import { TABLES, MAX_ROW_BYTES, compareManifests, exportSnapshot, getManifest, importSnapshot, validateSnapshot } from '../cloudflare/data-transfer.mjs';

function database(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  createHouseApplication({ db, env: {}, setupToken: '' });
  db.exec('DELETE FROM notification_meta');
  return db;
}

const originalVapid = JSON.stringify(webpush.generateVAPIDKeys());
const freshVapid = JSON.stringify(webpush.generateVAPIDKeys());

function insert(db, name, values) {
  const definition = TABLES.find(table => table.name === name);
  db.prepare(`INSERT INTO ${name} (${definition.columns.join(',')}) VALUES (${definition.columns.map(() => '?').join(',')})`).run(...values);
}

function filled(t) {
  const db = database(t);
  insert(db, 'users', ['admin', 'Ana "Água"', 'ana@example.test', '(11) 99999-0000', 'admin', 1, 'original-scrypt-hash', 'original-salt', null, null]);
  insert(db, 'users', ['inactive', 'Inativo', 'inactive@example.test', '', 'member', 0, null, null, 'invite-hash', 1792500000000]);
  insert(db, 'settings', [1, '{"houseName":"Casa completa","autoGenerate":false}']);
  insert(db, 'templates', ['template', 'Limpar', 'Cozinha', 20, '20:00', 0, 'kitchen', '[1,3]']);
  insert(db, 'tasks', ['task-a', 'template', 'Histórico', 'Cozinha', 20, '20:00', '2026-10-19', 'admin', 'done', '2026-10-19T22:00:00.000Z', 10, '2026-10-18T22:00:00.000Z', 'kitchen']);
  insert(db, 'tasks', ['task-b', null, 'Manual', 'Sala', 10, '21:00', '2026-10-20', 'inactive', 'paused', null, 0, '2026-10-19T22:00:00.000Z', 'sofa']);
  insert(db, 'sessions', ['session-hash', 'admin', 1792500000000]);
  insert(db, 'swaps', ['swap', 'task-a', 'task-b', 'admin', 'inactive', 'accepted', '2026-10-19T22:00:00.000Z', '2026-10-19T23:00:00.000Z']);
  insert(db, 'calendar_archives', ['archive', '2026-10-19T22:00:00.000Z', 'admin', 1, 0, '{"tasks":[{"id":"older","points":10}],"swaps":[]}']);
  insert(db, 'weekly_draw_plans', ['2026-10-19', '[{"date":"2026-10-21","templateId":"template"}]']);
  insert(db, 'profile_photos', ['admin', 'image/png', Buffer.from([0, 255, 128, 10, 13, 0]), 'original-photo-version']);
  insert(db, 'notification_meta', ['vapid', originalVapid]);
  insert(db, 'notification_preferences', ['admin', 1, 0, '10:30']);
  insert(db, 'notification_subscriptions', ['https://push.example.test/device', 'admin', '{"endpoint":"https://push.example.test/device","keys":{"auth":"private"}}', 1792500000000]);
  insert(db, 'notification_deliveries', ['delivery', '2026-10-19:admin:email:daily', 'admin', 'email', '', 'uncertain', 1792500000000, 1792500001000, 1, 0, 'Resultado incerto.', 'reminder']);
  return db;
}

function transaction(db) {
  return fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
}

test('snapshot preserva as 13 tabelas, binários, nulos, credenciais e estado de entregas', t => {
  const source = filled(t), target = database(t);
  const snapshot = exportSnapshot(source);
  assert.equal(snapshot.tables.length, 13);
  assert.equal(validateSnapshot(snapshot).counts.users, 2);
  const photo = snapshot.tables.find(table => table.name === 'profile_photos').rows[0];
  assert.deepEqual(photo[2], { $blob: 'AP+ACg0A' });
  const manifest = importSnapshot(target, JSON.parse(JSON.stringify(snapshot)), { transaction: transaction(target) });
  assert.deepEqual(manifest, snapshot.manifest);
  assert.equal(compareManifests(getManifest(source), getManifest(target)).equal, true);
  assert.deepEqual(Buffer.from(target.prepare('SELECT data FROM profile_photos').get().data), Buffer.from([0, 255, 128, 10, 13, 0]));
  assert.equal(target.prepare('SELECT password_hash FROM users WHERE id=?').get('admin').password_hash, 'original-scrypt-hash');
  assert.equal(target.prepare('SELECT status FROM notification_deliveries').get().status, 'uncertain');
  assert.deepEqual(target.prepare('PRAGMA foreign_key_check').all(), []);
});

test('manifesto é determinístico entre exportações e independente da ordem das tabelas e linhas', t => {
  const source = filled(t), a = exportSnapshot(source, { createdAt: '2026-10-20T00:00:00.000Z' });
  const b = exportSnapshot(source, { createdAt: '2026-10-21T00:00:00.000Z' });
  assert.deepEqual(a.manifest, b.manifest);
  b.tables.reverse(); b.tables.forEach(table => table.rows.reverse());
  assert.deepEqual(validateSnapshot(b).manifest, a.manifest);
});

test('restauração substitui somente VAPID recém-gerada e preserva a VAPID original', t => {
  const target = database(t), snapshot = exportSnapshot(filled(t));
  insert(target, 'notification_meta', ['vapid', freshVapid]);
  importSnapshot(target, snapshot, { transaction: transaction(target) });
  assert.equal(target.prepare("SELECT value FROM notification_meta WHERE key='vapid'").get().value, originalVapid);
});

test('recusa destinos não vazios sem modificar qualquer tabela', t => {
  const source = filled(t), target = filled(t);
  const before = getManifest(target);
  assert.throws(() => importSnapshot(target, exportSnapshot(source), { transaction: transaction(target) }), /destino contém registros/);
  assert.deepEqual(getManifest(target), before);
});

test('valida integridade, tabelas completas, tipos e referências antes de escrever', t => {
  const source = filled(t), target = database(t);
  const original = exportSnapshot(source), initial = getManifest(target);
  const modified = structuredClone(original);
  modified.tables.find(table => table.name === 'users').rows[0][1] = 'Alterado';
  assert.throws(() => importSnapshot(target, modified, { transaction: transaction(target) }), /SHA-256/);
  const missing = structuredClone(original); missing.tables.pop();
  assert.throws(() => validateSnapshot(missing), /13 tabelas/);
  const orphan = structuredClone(original);
  orphan.tables.find(table => table.name === 'tasks').rows[0][7] = 'missing-user';
  assert.throws(() => validateSnapshot(orphan), /Referência órfã/);
  const badInteger = structuredClone(original);
  badInteger.tables.find(table => table.name === 'sessions').rows[0][2] = '1792500000000';
  assert.throws(() => validateSnapshot(badInteger), /Inteiro inválido/);
  const blob = structuredClone(original);
  blob.tables.find(table => table.name === 'profile_photos').rows[0][2].$blob = '*invalid*';
  assert.throws(() => validateSnapshot(blob), /Base64 inválido/);
  assert.deepEqual(getManifest(target), initial);
});

test('falha durante importação reverte todas as inserções e restaura VAPID do destino', t => {
  const target = database(t), snapshot = exportSnapshot(filled(t));
  insert(target, 'notification_meta', ['vapid', freshVapid]);
  const before = getManifest(target);
  const failing = {
    prepare(sql) {
      if (sql.startsWith('INSERT INTO "swaps"')) return { run() { throw new Error('Falha simulada após inserir usuários e tarefas.'); } };
      return target.prepare(sql);
    },
  };
  assert.throws(() => importSnapshot(failing, snapshot, { transaction: transaction(target) }), /Falha simulada/);
  assert.deepEqual(getManifest(target), before);
});

test('recusa linhas grandes sem truncar o arquivo e exige transação explícita', t => {
  const snapshot = exportSnapshot(filled(t));
  const large = structuredClone(snapshot);
  const archives = large.tables.find(table => table.name === 'calendar_archives');
  archives.rows[0][archives.columns.indexOf('data')] = 'x'.repeat(MAX_ROW_BYTES + 1);
  assert.throws(() => validateSnapshot(large), /excede 2 MB/);
  assert.throws(() => importSnapshot(database(t), snapshot), /transação atômica/);
});

test('recusa JSON e VAPID corrompidos antes de escrever e informa status adequado', t => {
  const target = database(t), snapshot = exportSnapshot(filled(t)), before = getManifest(target);
  for (const [name, column, invalid] of [['settings', 'value', '{invalid'], ['templates', 'weekdays', '{}'], ['weekly_draw_plans', 'data', '{}'], ['calendar_archives', 'data', '[]'], ['notification_subscriptions', 'subscription', 'null'], ['notification_meta', 'value', '{"publicKey":"invalid","privateKey":"invalid"}']]) {
    const corrupt = structuredClone(snapshot), table = corrupt.tables.find(table => table.name === name);
    table.rows[0][table.columns.indexOf(column)] = invalid;
    assert.throws(() => importSnapshot(target, corrupt, { transaction: transaction(target) }), error => error.status === 400 && /JSON|VAPID/.test(error.message));
    assert.deepEqual(getManifest(target), before);
  }
  const occupied = filled(t);
  assert.throws(() => importSnapshot(occupied, snapshot, { transaction: transaction(occupied) }), error => error.status === 409);
});

test('exportação recusa tabelas e colunas extras para nunca descartar dados silenciosamente', t => {
  const extraTable = database(t); extraTable.exec('CREATE TABLE future_records (id TEXT)');
  assert.throws(() => exportSnapshot(extraTable), /tabelas não reconhecidas/);
  const extraColumn = database(t); extraColumn.exec('ALTER TABLE users ADD COLUMN future_value TEXT');
  assert.throws(() => exportSnapshot(extraColumn), /Nenhuma coluna será descartada/);
});

test('detecta UNIQUE duplicado e divergência de manifesto por tabela', t => {
  const snapshot = exportSnapshot(filled(t)), duplicate = structuredClone(snapshot);
  const users = duplicate.tables.find(table => table.name === 'users').rows;
  users[1][2] = users[0][2];
  assert.throws(() => validateSnapshot(duplicate), /UNIQUE duplicada em users/);
  const altered = structuredClone(snapshot.manifest);
  altered.tables.find(table => table.name === 'sessions').count++;
  const result = compareManifests(snapshot.manifest, altered);
  assert.equal(result.equal, false);
  assert.ok(result.differences.some(value => value.includes('sessions')));
});
