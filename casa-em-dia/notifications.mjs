import webpush from 'web-push';
import { randomUUID, createHash } from 'node:crypto';
import { localNow } from './rules.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value ?? '').replace(/[\r\n\u0000-\u001f]/g, ' ').trim();
function validPublicUrl(value) {
    try { const url = new URL(value); if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null; if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null; return url.origin + '/'; } catch { return null; }
}
export function normalizePhone(value) {
    const original = String(value ?? '').trim(); if (!/^[+\d\s().-]+$/.test(original)) return null;
    const digits = original.replace(/\D/g, ''); if (original.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : null;
    if (/^55[1-9]\d{9,10}$/.test(digits)) return '+' + digits;
    if (/^[1-9]\d{9,10}$/.test(digits)) return '+55' + digits;
    return null;
}
function subscriptionValue(value) {
    if (!value || typeof value !== 'object' || typeof value.endpoint !== 'string' || value.endpoint.length > 4096) fail('Inscrição de notificações inválida.');
    let url; try { url = new URL(value.endpoint); } catch { fail('Endereço de notificações inválido.'); }
    const host = url.hostname.toLowerCase();
    const allowed = host === 'fcm.googleapis.com' || ['push.apple.com', 'push.services.mozilla.com', 'notify.windows.com'].some(domain => host === domain || host.endsWith('.' + domain));
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !allowed) fail('Serviço de notificações não autorizado.');
    const keys = value.keys;
    for (const [key, size] of [['p256dh', 65], ['auth', 16]]) if (typeof keys?.[key] !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys[key]) || Buffer.from(keys[key], 'base64url').length !== size) fail('Chaves de notificações inválidas.');
    if (Buffer.from(keys.p256dh, 'base64url')[0] !== 4) fail('Chave pública de notificações inválida.');
    return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function createNotifications({ db, settings, now = localNow, env = process.env, fetchImpl = globalThis.fetch, pushClient = webpush }) {
    const one = (sql, ...args) => db.prepare(sql).get(...args), all = (sql, ...args) => db.prepare(sql).all(...args), run = (sql, ...args) => db.prepare(sql).run(...args);
    db.exec(`CREATE TABLE IF NOT EXISTS notification_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notification_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id),email_enabled INTEGER NOT NULL DEFAULT 0,sms_enabled INTEGER NOT NULL DEFAULT 0,reminder_time TEXT NOT NULL DEFAULT '09:00');
 CREATE TABLE IF NOT EXISTS notification_subscriptions (endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),subscription TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS notification_deliveries (id TEXT PRIMARY KEY,delivery_key TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL REFERENCES users(id),channel TEXT NOT NULL,endpoint TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,error TEXT,kind TEXT NOT NULL DEFAULT 'reminder');
 CREATE INDEX IF NOT EXISTS notification_user ON notification_deliveries(user_id,created_at);
 CREATE INDEX IF NOT EXISTS notification_subscriber ON notification_subscriptions(user_id);`);
    const stored = one("SELECT value FROM notification_meta WHERE key='vapid'");
    const vapid = stored ? JSON.parse(stored.value) : webpush.generateVAPIDKeys();
    if (!stored) run("INSERT INTO notification_meta(key,value) VALUES('vapid',?)", JSON.stringify(vapid));
    const publicUrl = validPublicUrl(env.CASA_PUBLIC_URL);
    const vapidSubject = () => {
        if (publicUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(publicUrl).hostname)) return publicUrl;
        const contact = env.BREVO_FROM_EMAIL || one('SELECT email FROM users WHERE active=1 AND password_hash IS NOT NULL LIMIT 1')?.email;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact || '') ? 'mailto:' + contact : 'mailto:notifications@example.com';
    };
    const emailConfigured = () => !!(env.BREVO_API_KEY && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.BREVO_FROM_EMAIL || ''));
    const smsConfigured = () => env.CASA_SMS_ENABLED === '1' && !!env.BREVO_API_KEY && /^[A-Za-z0-9]{3,11}$/.test(env.BREVO_SMS_SENDER || '');
    const clock = () => { const value = now(); return { ...value, stamp: Number.isFinite(value.stamp) ? value.stamp : Date.now() }; };
    const preferences = userId => { const p = one('SELECT * FROM notification_preferences WHERE user_id=?', userId); return { emailEnabled: !!p?.email_enabled, smsEnabled: !!p?.sms_enabled, reminderTime: p?.reminder_time || '09:00' }; };
    const active = userId => one('SELECT * FROM users WHERE id=? AND active=1 AND password_hash IS NOT NULL', userId);
    const pending = (userId, date) => all("SELECT title,due_date,deadline FROM tasks WHERE assignee_id=? AND status='pending' AND due_date<=? ORDER BY due_date,deadline,id", userId, date);
    const configured = channel => channel === 'push' || (channel === 'email' ? emailConfigured() : smsConfigured());
    let stopped = false, inflight = null;
    const running = new Set();
    function status(userId) {
        return { email: { configured: emailConfigured(), provider: 'Brevo' }, sms: { configured: smsConfigured(), provider: 'Brevo' }, push: { configured: true, publicKey: vapid.publicKey }, preferences: preferences(userId), subscriptionCount: Number(one('SELECT count(*) AS n FROM notification_subscriptions WHERE user_id=?', userId).n), recent: all('SELECT channel,status,created_at,error FROM notification_deliveries WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 12', userId).map(row => ({ channel: row.channel, status: row.status, createdAt: new Date(row.created_at).toISOString(), error: row.error })) };
    }
    function savePreferences(userId, value) {
        if (!active(userId)) fail('Morador indisponível.', 403);
        if (typeof value?.emailEnabled !== 'boolean' || typeof value?.smsEnabled !== 'boolean') fail('Escolha quais notificações deseja receber.');
        if (typeof value.reminderTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.reminderTime) || value.reminderTime < '08:00' || value.reminderTime >= '21:00') fail('Escolha um horário entre 08:00 e 20:59.');
        if (value.smsEnabled && !normalizePhone(active(userId).phone)) fail('Informe um telefone válido com DDD para ativar SMS.');
        run('INSERT INTO notification_preferences(user_id,email_enabled,sms_enabled,reminder_time) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_enabled=excluded.email_enabled,sms_enabled=excluded.sms_enabled,reminder_time=excluded.reminder_time', userId, Number(value.emailEnabled), Number(value.smsEnabled), value.reminderTime);
        return preferences(userId);
    }
    function contactChanged(userId, { emailChanged = false, phoneChanged = false, deactivated = false } = {}) {
        if (emailChanged || deactivated) run('UPDATE notification_preferences SET email_enabled=0 WHERE user_id=?', userId);
        if (phoneChanged || deactivated) run('UPDATE notification_preferences SET sms_enabled=0 WHERE user_id=?', userId);
        if (deactivated) run('DELETE FROM notification_subscriptions WHERE user_id=?', userId);
    }
    function hasSubscription(userId, endpoint) { return typeof endpoint === 'string' && !!one('SELECT 1 FROM notification_subscriptions WHERE user_id=? AND endpoint=?', userId, endpoint); }
    function subscribe(userId, value) {
        if (!active(userId)) fail('Morador indisponível.', 403);
        const subscription = subscriptionValue(value), existing = one('SELECT user_id FROM notification_subscriptions WHERE endpoint=?', subscription.endpoint);
        if (existing && existing.user_id !== userId) fail('Este aparelho já está associado a outro morador. Desative as notificações na conta anterior.', 409);
        if (!existing && Number(one('SELECT count(*) AS n FROM notification_subscriptions WHERE user_id=?', userId).n) >= 10) fail('Limite de 10 aparelhos atingido.');
        run('INSERT INTO notification_subscriptions(endpoint,user_id,subscription,created_at) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription', subscription.endpoint, userId, JSON.stringify(subscription), clock().stamp);
    }
    function unsubscribe(userId, endpoint) { if (typeof endpoint !== 'string' || endpoint.length > 4096) fail('Endereço de notificações inválido.'); run('DELETE FROM notification_subscriptions WHERE user_id=? AND endpoint=?', userId, endpoint); }
    function resultError(message, { status = 502, retry = false, uncertain = false, expired = false } = {}) { return Object.assign(new Error(message), { status, retry, uncertain, expired }); }
    async function provider(row, user, tasks, isTest) {
        const count = tasks.length;
        if (row.channel === 'push') {
            const stored = one('SELECT subscription FROM notification_subscriptions WHERE user_id=? AND endpoint=?', user.id, row.endpoint);
            if (!stored) throw resultError('Este aparelho não está inscrito.', { status: 404 });
            const subscription = subscriptionValue(JSON.parse(stored.subscription));
            const payload = JSON.stringify({ title: isTest ? 'Casa em Dia: teste' : 'Casa em Dia', body: isTest ? 'As notificações deste aparelho estão configuradas.' : `Você tem ${count} atividade${count === 1 ? '' : 's'} pendente${count === 1 ? '' : 's'}. Abra a agenda para conferir.`, url: publicUrl || '/', tag: isTest ? 'casa-teste' : 'casa-lembrete' });
            try { await pushClient.sendNotification(subscription, payload, { vapidDetails: { subject: vapidSubject(), publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 3600, timeout: 10000 }); return; }
            catch (error) { const code = Number(error.statusCode); if (code === 404 || code === 410) { run('DELETE FROM notification_subscriptions WHERE user_id=? AND endpoint=?', user.id, row.endpoint); throw resultError('Inscrição expirada. Ative as notificações novamente.', { expired: true }); } throw resultError('O serviço de notificações não aceitou o envio.', { retry: code === 429 || code >= 500, uncertain: !code }); }
        }
        let path, body;
        if (row.channel === 'email') {
            path = 'smtp/email';
            const titles = tasks.slice(0, 30).map(task => `- ${clean(task.title).slice(0, 150)} (${task.due_date}, até ${task.deadline})`);
            const textContent = isTest ? 'Este é um teste de e-mail da Casa em Dia.' : `Você tem ${count} atividade${count === 1 ? '' : 's'} pendente${count === 1 ? '' : 's'} até hoje.\n\n${titles.join('\n')}${count > 30 ? '\nConsulte as demais atividades na agenda.' : ''}`;
            body = { sender: { email: env.BREVO_FROM_EMAIL, name: clean(env.BREVO_FROM_NAME || 'Casa em Dia').slice(0, 70) }, to: [{ email: user.email }], subject: isTest ? 'Casa em Dia: teste de e-mail' : 'Casa em Dia: atividades pendentes', textContent: textContent + (publicUrl ? '\n\nAbra sua agenda: ' + publicUrl : ''), headers: { idempotencyKey: row.id } };
        } else {
            const recipient = normalizePhone(user.phone); if (!recipient) throw resultError('Cadastre um telefone válido com DDD.', { status: 400 });
            path = 'transactionalSMS/send'; body = { sender: env.BREVO_SMS_SENDER, recipient, type: 'transactional', content: (isTest ? 'Casa em Dia: teste de SMS.' : `Casa em Dia: voce tem ${count} atividade(s) pendente(s). Abra sua agenda para conferir.`).slice(0, 150) };
        }
        let response;
        // Workers supports manual/follow redirects. Reject 3xx below without
        // forwarding the API key or message to another endpoint.
        try { response = await fetchImpl('https://api.brevo.com/v3/' + path, { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: 'manual' }); }
        catch { throw resultError('Não foi possível confirmar o envio com o serviço. Confira antes de testar novamente.', { uncertain: true }); }
        if (!response.ok) { const code = Number(response.status); try { await response.body?.cancel(); } catch { } throw resultError(code === 429 ? 'Limite do serviço atingido. Aguarde antes de tentar novamente.' : 'O serviço de envio rejeitou a solicitação. Confira a configuração.', { retry: code === 429, uncertain: code >= 500 }); }
        try { await response.body?.cancel(); } catch { }
    }
    function eligible(row, current) {
        const user = active(row.user_id); if (!user || !configured(row.channel)) return null;
        if (row.kind === 'test') return { user, tasks: [] };
        if (settings().paused || current.time < '08:00' || current.time >= '21:00') return null;
        const p = preferences(user.id);
        if (row.channel === 'email' && (!p.emailEnabled || current.time < p.reminderTime)) return null;
        if (row.channel === 'sms' && (!p.smsEnabled || current.time < p.reminderTime || !normalizePhone(user.phone))) return null;
        if (row.channel === 'push') {
            if (!hasSubscription(user.id, row.endpoint)) return null;
            const interval = [15, 30, 60, 120].includes(Number(settings().reminderMinutes)) ? Number(settings().reminderMinutes) : 30;
            const minutes = Number(current.time.slice(0, 2)) * 60 + Number(current.time.slice(3)), bucket = Math.floor(minutes / interval);
            if (row.delivery_key !== `${current.date}:${user.id}:push:${digest(row.endpoint)}:${interval}:${bucket}`) return null;
        }
        const tasks = pending(user.id, current.date); return tasks.length ? { user, tasks } : null;
    }
    async function dispatch(id) {
        const row = one('SELECT * FROM notification_deliveries WHERE id=?', id), current = clock();
        if (!row || row.attempts >= 3 || row.next_attempt > current.stamp || !['queued', 'retry'].includes(row.status)) return null;
        const data = eligible(row, current);
        if (!data) { run("UPDATE notification_deliveries SET status='cancelled',updated_at=? WHERE id=?", current.stamp, id); return null; }
        const claimed = run("UPDATE notification_deliveries SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('queued','retry')", current.stamp, id);
        if (!claimed.changes) return null;
        try { await provider(row, data.user, data.tasks, row.kind === 'test'); run("UPDATE notification_deliveries SET status='accepted',error=NULL,updated_at=? WHERE id=?", clock().stamp, id); return { status: 'accepted' }; }
        catch (error) {
            const safe = error.status ? error : resultError('Não foi possível concluir o envio.', { uncertain: true });
            const retry = row.kind !== 'test' && safe.retry && row.attempts + 1 < 3 && current.stamp - row.created_at < 25 * 60000;
            const status = retry ? 'retry' : safe.uncertain ? 'uncertain' : safe.expired ? 'rejected' : 'failed';
            run('UPDATE notification_deliveries SET status=?,error=?,updated_at=?,next_attempt=? WHERE id=?', status, safe.message, current.stamp, current.stamp + (row.attempts === 0 ? 60000 : 300000), id);
            if (row.kind === 'test') throw safe;
            return { status };
        }
    }
    function enqueue(userId, channel, key, endpoint = '', kind = 'reminder') {
        const id = randomUUID(), stamp = clock().stamp;
        run("INSERT OR IGNORE INTO notification_deliveries(id,delivery_key,user_id,channel,endpoint,status,created_at,updated_at,kind) VALUES(?,?,?,?,?,'queued',?,?,?)", id, key, userId, channel, endpoint, stamp, stamp, kind);
        return one('SELECT id FROM notification_deliveries WHERE delivery_key=?', key).id;
    }
    function track(promise) { running.add(promise); promise.finally(() => running.delete(promise)).catch(() => { }); return promise; }
    async function sendTest(userId, channel, endpoint) {
        if (stopped) fail('O serviço está encerrando.', 503);
        if (!['push', 'email', 'sms'].includes(channel)) fail('Canal de notificação inválido.');
        if (!active(userId)) fail('Morador indisponível.', 403);
        if (!configured(channel)) fail('Configure este serviço no servidor antes de enviar um teste.', 503);
        if (channel === 'push' && !hasSubscription(userId, endpoint)) fail('Ative as notificações neste aparelho antes de testar.', 400);
        if (channel === 'sms' && !normalizePhone(active(userId).phone)) fail('Cadastre um telefone válido com DDD.');
        const current = clock(), previous = one("SELECT created_at FROM notification_deliveries WHERE user_id=? AND channel=? AND kind='test' ORDER BY created_at DESC LIMIT 1", userId, channel);
        if (previous && current.stamp - previous.created_at < 60000) fail('Aguarde um minuto entre testes deste canal.', 429);
        const id = enqueue(userId, channel, 'test:' + randomUUID(), channel === 'push' ? endpoint : '', 'test');
        return track(dispatch(id));
    }
    function tick() {
        if (stopped) return Promise.resolve(); if (inflight) return inflight;
        const promise = (async () => {
            const current = clock();
            run('DELETE FROM notification_deliveries WHERE created_at<?', current.stamp - 90 * 86400000);
            // A process interrupted after dispatch cannot know whether the provider accepted it.
            run("UPDATE notification_deliveries SET status='uncertain',error='Envio interrompido; confirme o recebimento antes de testar novamente.' WHERE status='sending' AND updated_at<?", current.stamp - 120000);
            if (settings().paused || current.time < '08:00' || current.time >= '21:00') return;
            const interval = [15, 30, 60, 120].includes(Number(settings().reminderMinutes)) ? Number(settings().reminderMinutes) : 30;
            const minutes = Number(current.time.slice(0, 2)) * 60 + Number(current.time.slice(3)), bucket = Math.floor(minutes / interval);
            for (const user of all('SELECT id FROM users WHERE active=1 AND password_hash IS NOT NULL')) {
                if (!pending(user.id, current.date).length) continue;
                const p = preferences(user.id);
                for (const channel of ['email', 'sms']) if (configured(channel) && p[channel + 'Enabled'] && current.time >= p.reminderTime && (channel !== 'sms' || normalizePhone(active(user.id)?.phone))) enqueue(user.id, channel, `${current.date}:${user.id}:${channel}:daily`);
                for (const subscription of all('SELECT endpoint FROM notification_subscriptions WHERE user_id=?', user.id)) enqueue(user.id, 'push', `${current.date}:${user.id}:push:${digest(subscription.endpoint)}:${interval}:${bucket}`, subscription.endpoint);
            }
            for (const row of all("SELECT id FROM notification_deliveries WHERE kind='reminder' AND status IN ('queued','retry') AND next_attempt<=? AND created_at>=? ORDER BY created_at", current.stamp, Date.parse(current.date + 'T00:00:00-03:00'))) { if (stopped) break; await dispatch(row.id); }
        })();
        inflight = track(promise); promise.finally(() => { inflight = null; }).catch(() => { }); return promise;
    }
    async function stop() { stopped = true; await Promise.allSettled([...running]); }
    return { status, savePreferences, contactChanged, subscribe, unsubscribe, hasSubscription, sendTest, tick, stop };
}

