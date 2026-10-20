import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { createDurableSqliteDatabase, createPersistentRateLimiter } from '../cloudflare/sqlite-adapter.mjs';
import { nodeRequest, readJson, securityHeaders, withSecurity } from '../cloudflare/http.mjs';
import { createFetchPushClient } from '../cloudflare/push-client.mjs';

// Emulate the Durable Object cursor with SQLite itself, including ArrayBuffer
// blobs and a write metric that includes index work rather than affected rows.
function storageFixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const storage = {
    sql: {
      exec(query, ...values) {
        let result = [];
        for (const statement of query.split(';').map(sql => sql.trim()).filter(Boolean)) {
          const bindings = values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
          result = sqlite.prepare(statement).all(...bindings).map(row => Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, ArrayBuffer.isView(value) ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value]),
          ));
        }
        return { toArray: () => result, rowsWritten: 71 };
      },
    },
    transactionSync(fn) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = fn(); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, storage, db: createDurableSqliteDatabase(storage) };
}

function streamingRequest(content, { headers = {}, onCancel = () => {} } = {}) {
  const bytes = new TextEncoder().encode(content);
  let offset = 0;
  return new Request('https://agenda.example.test/api/example?source=mobile', {
    method: 'POST', duplex: 'half',
    headers: { Origin: 'https://agenda.example.test', 'Content-Type': 'application/json', ...headers },
    body: new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(offset, ++offset));
      },
      cancel: onCancel,
    }),
  });
}

test('adaptador preserva BLOBs com offset e relata linhas alteradas sem contar índices', t => {
  const { db } = storageFixture(t);
  db.exec('CREATE TABLE photos (id INTEGER PRIMARY KEY,label TEXT,data BLOB); CREATE INDEX photos_label ON photos(label)');
  const bytes = Uint8Array.from([99, 0, 128, 255, 42, 88]);
  const first = db.prepare('INSERT INTO photos(label,data) VALUES(?,?)').run('first', bytes.subarray(1, 5));
  const second = db.prepare('INSERT INTO photos(label,data) VALUES(?,?)').run('second', new DataView(bytes.buffer, 2, 2));
  assert.equal(first.changes, 1);
  assert.equal(second.lastInsertRowid, 2);
  const photo = db.prepare('SELECT data FROM photos WHERE id=?').get(1);
  assert.ok(Buffer.isBuffer(photo.data));
  assert.deepEqual([...photo.data], [0, 128, 255, 42]);
  assert.deepEqual([...db.prepare('SELECT data FROM photos WHERE id=?').get(2).data], [128, 255]);
  assert.equal(db.prepare('UPDATE photos SET label=? WHERE id=?').run('changed', 1).changes, 1);
  assert.equal(db.prepare('UPDATE photos SET label=? WHERE id=?').run('absent', 999).changes, 0);
  assert.equal(db.prepare('SELECT id FROM photos ORDER BY id').all().length, 2);
  assert.throws(() => db.prepare('INSERT INTO photos(label) VALUES(?)').run(undefined), TypeError);
});

test('transação síncrona confirma juntas as alterações e reverte falhas ou retorno de Promise', t => {
  const { db } = storageFixture(t);
  db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY,title TEXT NOT NULL)');
  const add = title => db.prepare('INSERT INTO events(title) VALUES(?)').run(title);
  assert.equal(db.transaction(() => { add('committed'); return 'ok'; }), 'ok');
  const failure = new Error('archive failed');
  assert.throws(() => db.transaction(() => { add('partial-a'); add('partial-b'); throw failure; }), error => error === failure);
  assert.throws(() => db.transaction(() => { add('async-partial'); return Promise.resolve('invalid'); }), TypeError);
  assert.deepEqual(db.prepare('SELECT title FROM events').all().map(row => row.title), ['committed']);
  assert.equal(db.transaction(() => add('next')).changes, 1);
});

test('limite persiste entre instâncias, registra tentativas bloqueadas e expira sem ampliar a janela', t => {
  const { db, storage } = storageFixture(t);
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const request = { socket: { remoteAddress: '192.0.2.15' } };
  const first = createPersistentRateLimiter(db);
  first(request, 'login', 2);
  now += 10_000;
  first(request, 'login', 2);
  const recreated = createPersistentRateLimiter(createDurableSqliteDatabase(storage));
  for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => recreated(request, 'login', 2), { status: 429 });
  const stored = db.prepare('SELECT key,count,expires FROM _casa_rate_limits').get();
  assert.equal(stored.count, 4);
  assert.equal(stored.expires, 1_900_000);
  assert.ok(!stored.key.includes(request.socket.remoteAddress));
  recreated(request, 'invite-info', 2);
  recreated({ socket: { remoteAddress: '192.0.2.16' } }, 'login', 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM _casa_rate_limits').get().n, 3);
  now = 1_910_001;
  recreated(request, 'login', 2);
  assert.equal(db.prepare('SELECT count FROM _casa_rate_limits').get().count, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM _casa_rate_limits').get().n, 1);
});

test('requisição compatível com Node mantém Unicode mesmo dividido byte a byte e deriva host/HTTPS', async () => {
  const expected = { title: 'Ação na cozinha 🧹', person: 'João' };
  const request = streamingRequest(JSON.stringify(expected), { headers: { 'CF-Connecting-IP': '192.0.2.20', 'X-Forwarded-Proto': 'http' } });
  const adapted = nodeRequest(request);
  let raw = '';
  for await (const chunk of adapted) raw += chunk;
  assert.deepEqual(JSON.parse(raw), expected);
  assert.equal(adapted.url, '/api/example?source=mobile');
  assert.equal(adapted.headers.host, 'agenda.example.test');
  assert.equal(adapted.headers['x-forwarded-proto'], 'https');
  assert.equal(adapted.socket.remoteAddress, '192.0.2.20');
});

test('leitura JSON limita bytes reais, cancela excesso e trata tamanho declarado e JSON inválido', async () => {
  const expected = { title: 'Limpar área 🧹' };
  const json = JSON.stringify(expected), size = Buffer.byteLength(json);
  assert.deepEqual(await readJson(streamingRequest(json), size), expected);
  let cancelled = false;
  await assert.rejects(readJson(streamingRequest(json, { onCancel: () => { cancelled = true; } }), size - 1), { status: 413 });
  assert.equal(cancelled, true);
  await assert.rejects(readJson(streamingRequest('{}', { headers: { 'Content-Length': '500' } }), 100), { status: 413 });
  await assert.rejects(readJson(streamingRequest('{broken json'), 100), { status: 400 });
});

test('cabeçalhos de segurança preservam tipo/cache e aplicam HSTS apenas em HTTPS', () => {
  const secure = securityHeaders({ 'Content-Type': 'image/png', 'Cache-Control': 'private' });
  assert.equal(secure.get('Content-Type'), 'image/png');
  assert.equal(secure.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(secure.get('X-Frame-Options'), 'DENY');
  assert.equal(secure.get('Strict-Transport-Security'), 'max-age=31536000');
  assert.match(secure.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  const response = withSecurity(new Response('local', { status: 201, headers: { 'Cache-Control': 'private' } }), new Request('http://localhost/'));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'private');
  assert.equal(response.headers.get('Strict-Transport-Security'), null);
});

function pushFixture() {
  return {
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/runtime-test-device', keys: { p256dh: webpush.generateVAPIDKeys().publicKey, auth: randomBytes(16).toString('base64url') } },
    options: { vapidDetails: { subject: 'mailto:notifications@example.test', ...webpush.generateVAPIDKeys() }, TTL: 3600, timeout: 1000 },
  };
}

test('Web Push usa criptografia VAPID real e Fetch com corpo cifrado, prazo e redirecionamento bloqueado', async () => {
  const { subscription, options } = pushFixture();
  const sent = [];
  const client = createFetchPushClient(async (url, init) => { sent.push({ url, init }); return new Response(null, { status: 201 }); });
  const payload = JSON.stringify({ title: 'Casa em Dia', body: 'Atividade pendente.' });
  assert.deepEqual(await client.sendNotification(subscription, payload, options), { statusCode: 201 });
  assert.equal(sent.length, 1);
  const { url, init } = sent[0], headers = new Headers(init.headers);
  assert.equal(url, subscription.endpoint);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(headers.get('TTL'), '3600');
  assert.equal(headers.get('Content-Encoding'), 'aes128gcm');
  assert.equal(headers.get('Content-Type'), 'application/octet-stream');
  assert.match(headers.get('Authorization'), /^vapid t=.+, k=/);
  assert.ok(headers.get('Authorization').includes(options.vapidDetails.publicKey));
  assert.ok(Buffer.isBuffer(init.body));
  assert.ok(init.body.byteLength > Buffer.byteLength(payload));
  assert.ok(!init.body.includes(Buffer.from(payload)));
});

test('Web Push propaga status sem conteúdo privado, cancela resposta e não segue redirect com credenciais', async () => {
  const { subscription, options } = pushFixture();
  let cancelled = 0, calls = 0;
  const client = createFetchPushClient(async () => {
    calls++;
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 410 });
  });
  await assert.rejects(client.sendNotification(subscription, 'teste', options), error => error.statusCode === 410 && error.message === 'O serviço push rejeitou o envio.');
  assert.equal(cancelled, 1);
  const redirect = createFetchPushClient(async (url, init) => {
    calls++;
    assert.equal(init.redirect, 'error');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example.test/' } });
  });
  await assert.rejects(redirect.sendNotification(subscription, 'teste', options), { statusCode: 302 });
  assert.equal(calls, 2);
});
