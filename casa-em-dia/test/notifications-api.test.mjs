import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';

test('rotas de notificações isolam moradores, exigem sessão e não expõem credenciais', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'casa-notification-api-'));
  const child = spawn(process.execPath, ['server.mjs', '--api-only'], {
    cwd: resolve(import.meta.dirname, '..'), windowsHide: true,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', CASA_DATA_DIR: dataDir,
      BREVO_API_KEY: '', BREVO_FROM_EMAIL: '', CASA_SMS_ENABLED: '0', CASA_PUBLIC_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && !child.signalCode) await new Promise(done => { child.once('exit', done); child.kill('SIGTERM'); });
    if (resolve(dataDir).startsWith(resolve(tmpdir()) + sep) && basename(dataDir).startsWith('casa-notification-api-')) rmSync(dataDir, { recursive: true, force: true });
  });
  const { base, setup } = await new Promise((yes, no) => {
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => no(new Error('Servidor de teste não iniciou: ' + stderr)), 15000);
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', error => { clearTimeout(timeout); no(error); });
    child.once('exit', code => { clearTimeout(timeout); no(new Error('Servidor de teste encerrou: ' + code + ' ' + stderr)); });
    child.stdout.on('data', data => {
      stdout += data;
      const port = stdout.match(/Casa em Dia · http:\/\/localhost:(\d+)/)?.[1];
      const setup = stdout.match(/configurar=([a-f0-9]+)/)?.[1];
      if (port && setup) { clearTimeout(timeout); yes({ base: 'http://127.0.0.1:' + port, setup }); }
    });
  });
  async function call(path, data, cookie = '', extra = {}) {
    const response = await fetch(base + '/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(data === undefined ? {} : { Origin: base, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const initial = await call('setup', { houseName: 'Casa de notificações', name: 'Ana', email: 'ana@example.test', password: 'Senha de teste 2026!' }, '', { 'X-Setup-Token': setup });
  assert.equal(initial.status, 200);
  const admin = initial.cookie;
  assert.equal(initial.data.notifications.email.configured, false);
  assert.equal(initial.data.notifications.sms.configured, false);
  assert.equal(initial.data.notifications.preferences.emailEnabled, false);
  assert.equal(initial.data.notifications.preferences.smsEnabled, false);
  assert.match(initial.data.notifications.push.publicKey, /^[A-Za-z0-9_-]{87}$/);
  assert.ok(!JSON.stringify(initial.data).includes('privateKey'));
  assert.ok(!JSON.stringify(initial.data).includes('BREVO_API_KEY'));
  for (const path of ['notification-preferences', 'push-device', 'push-subscribe', 'push-unsubscribe', 'notification-test']) assert.equal((await call(path, {})).status, 401);
  assert.equal((await call('notification-preferences', { emailEnabled: false, smsEnabled: false, reminderTime: '09:00' }, admin, { Origin: 'https://outra-casa.test' })).status, 403);
  const invite = await call('save-user', { name: 'Bruno', email: 'bruno@example.test', phone: '', active: true }, admin);
  const accepted = await call('accept-invite', { token: invite.data.inviteToken, password: 'Senha Bruno 2026!' });
  const member = accepted.cookie;
  const saved = await call('notification-preferences', { emailEnabled: false, smsEnabled: false, reminderTime: '10:30', phone: '(11) 99999-1234', userId: initial.data.user.id }, member);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.notifications.preferences.reminderTime, '10:30');
  assert.equal(saved.data.user.phone, '(11) 99999-1234');
  assert.equal((await call('state', undefined, admin)).data.notifications.preferences.reminderTime, '09:00');
  for (const invalid of [{ reminderTime: '25:00' }, { reminderTime: '07:59' }, { reminderTime: '21:00' }, { emailEnabled: 'false' }, { smsEnabled: 1 }]) {
    assert.equal((await call('notification-preferences', { emailEnabled: false, smsEnabled: false, reminderTime: '09:00', ...invalid }, member)).status, 400);
  }
  assert.equal((await call('notification-test', { channel: 'email', to: 'third-party@example.test' }, member)).status, 503);
  assert.equal((await call('notification-test', { channel: 'invalid' }, member)).status, 400);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/casa-test-not-a-real-device',
    keys: { p256dh: webpush.generateVAPIDKeys().publicKey, auth: randomBytes(16).toString('base64url') },
  };
  const subscribed = await call('push-subscribe', { subscription }, member);
  assert.equal(subscribed.status, 200);
  assert.equal(subscribed.data.notifications.subscriptionCount, 1);
  assert.equal((await call('push-unsubscribe', { endpoint: subscription.endpoint }, admin)).status, 200);
  assert.equal((await call('state', undefined, member)).data.notifications.subscriptionCount, 1);
  for (const endpoint of ['http://127.0.0.1/push', 'https://127.0.0.1/push', 'https://fcm.googleapis.com.evil.test/push', 'https://fcm.googleapis.com:8443/push']) {
    assert.equal((await call('push-subscribe', { subscription: { ...subscription, endpoint } }, member)).status, 400);
  }
  const exported = await call('export', undefined, admin);
  assert.equal(exported.status, 200);
  assert.ok(!JSON.stringify(exported.data).includes(subscription.endpoint));
  assert.ok(!JSON.stringify(exported.data).includes(subscription.keys.auth));
  assert.ok(!JSON.stringify(exported.data).includes('privateKey'));
  assert.equal((await call('push-unsubscribe', { endpoint: subscription.endpoint }, member)).status, 200);
  assert.equal((await call('push-unsubscribe', { endpoint: subscription.endpoint }, member)).status, 200);
  assert.equal((await call('state', undefined, member)).data.notifications.subscriptionCount, 0);
});
