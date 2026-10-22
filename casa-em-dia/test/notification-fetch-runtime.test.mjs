import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';

// Use the real workerd Fetch implementation and production notification code.
// Every outbound request is intercepted locally; no provider receives a message.
const fixture = `
import { DurableObject } from 'cloudflare:workers';
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { createNotifications } from './notifications.mjs';
import { createFetchPushClient } from './cloudflare/push-client.mjs';
import { createDurableSqliteDatabase } from './cloudflare/sqlite-adapter.mjs';

export class NotificationFixture extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.db = createDurableSqliteDatabase(ctx.storage);
    this.db.exec(\`
      CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT,phone TEXT,active INTEGER,password_hash TEXT);
      CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,due_date TEXT,deadline TEXT,assignee_id TEXT,status TEXT);
      INSERT INTO users VALUES('test-user','Teste','recipient@example.test','+5511999991234',1,'registered');
    \`);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel');
    const scenario = url.searchParams.get('scenario');
    const api = createNotifications({
      db: this.db, settings: () => ({ paused: false, reminderMinutes: 30 }),
      env: { BREVO_API_KEY: 'local-fixture-' + scenario, BREVO_FROM_EMAIL: 'sender@example.test',
        CASA_PUBLIC_URL: 'https://casa.example.test', CASA_SMS_ENABLED: '1', BREVO_SMS_SENDER: 'CasaEmDia' },
      pushClient: createFetchPushClient(),
    });
    let endpoint;
    if (channel === 'push') {
      endpoint = 'https://fcm.googleapis.com/fcm/send/' + scenario;
      api.subscribe('test-user', { endpoint, keys: {
        p256dh: webpush.generateVAPIDKeys().publicKey, auth: randomBytes(16).toString('base64url'),
      } });
    }
    let outcome;
    try { outcome = await api.sendTest('test-user', channel, endpoint); }
    catch (error) { outcome = { status: 'error', httpStatus: error.status }; }
    const recent = api.status('test-user').recent;
    await api.stop();
    return Response.json({ outcome, recent });
  }
}
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    const name = url.searchParams.get('channel') + ':' + url.searchParams.get('scenario');
    return env.NOTIFICATIONS.getByName(name).fetch(request);
  },
};
`;

test('real workerd sends email, SMS and encrypted push and rejects redirects without forwarding credentials', { timeout: 30000 }, async t => {
  const bundled = await build({
    stdin: { contents: fixture, resolveDir: fileURLToPath(new URL('..', import.meta.url)), sourcefile: 'notification-runtime-fixture.mjs' },
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
    external: ['cloudflare:workers'],
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire("/");' },
  });
  const requests = [];
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-10-20', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { NOTIFICATIONS: { className: 'NotificationFixture', useSQLite: true } },
    log: new Log(LogLevel.ERROR),
    outboundService: async request => {
      const url = new URL(request.url);
      requests.push({ host: url.hostname, path: url.pathname });
      assert.ok(['api.brevo.com', 'fcm.googleapis.com'].includes(url.hostname), 'No request may reach a redirect destination.');
      assert.equal(request.method, 'POST');
      let scenario;
      if (url.hostname === 'api.brevo.com') {
        scenario = request.headers.get('api-key')?.replace('local-fixture-', '');
        const body = await request.json();
        if (url.pathname === '/v3/smtp/email') assert.equal(body.to[0].email, 'recipient@example.test');
        else { assert.equal(url.pathname, '/v3/transactionalSMS/send'); assert.equal(body.recipient, '+5511999991234'); }
      } else {
        scenario = url.pathname.split('/').at(-1);
        assert.match(request.headers.get('Authorization') || '', /^vapid /);
        assert.equal(request.headers.get('Content-Encoding'), 'aes128gcm');
        assert.ok((await request.arrayBuffer()).byteLength > 50);
      }
      assert.ok(['accepted', 'redirect'].includes(scenario));
      return scenario === 'redirect'
        ? new Response(null, { status: 302, headers: { Location: 'https://redirect-destination.invalid/private' } })
        : new Response(null, { status: 201 });
    },
  }));
  t.after(() => runtime.dispose());

  for (const channel of ['email', 'sms', 'push']) {
    for (const scenario of ['accepted', 'redirect']) {
      const before = requests.length;
      const response = await runtime.dispatchFetch('http://localhost/?channel=' + channel + '&scenario=' + scenario);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(requests.length, before + 1, channel + ' reaches exactly one local provider request.');
      assert.equal(result.recent.length, 1);
      assert.equal(result.recent[0].channel, channel);
      assert.equal(result.recent[0].status, scenario === 'accepted' ? 'accepted' : 'failed', channel + ': ' + JSON.stringify(result));
      if (scenario === 'accepted') assert.equal(result.outcome.status, 'accepted');
      else { assert.equal(result.outcome.httpStatus, 502); assert.doesNotMatch(result.recent[0].error, /redirect-destination|local-fixture|recipient@example/); }
    }
  }
  assert.equal(requests.length, 6);
});
