import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { localNow, validDate, nationalHolidays, defaultSettings, offReason, award, swappable } from './rules.mjs';
import { isActivityIcon, resolveActivityIcon } from './activity-icons.mjs';
import { createPhotoStore } from './profile-photos.mjs';
import { createNotifications } from './notifications.mjs';
import { loadEnvFile } from 'node:process';
import { ALL_WEEKDAYS, templateWeekdays, templateEligible, addDays, startOfWeek, requestedDates, planWeeklySlots } from './scheduling.mjs';

const root = dirname(fileURLToPath(import.meta.url));
try { loadEnvFile(resolve(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const dataDir = resolve(process.env.CASA_DATA_DIR || resolve(root, '.data'));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'casa.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT NOT NULL DEFAULT '',role TEXT NOT NULL DEFAULT 'member',active INTEGER NOT NULL DEFAULT 1,password_hash TEXT,password_salt TEXT,invite_hash TEXT,invite_expires INTEGER);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY,title TEXT NOT NULL,area TEXT NOT NULL,duration INTEGER NOT NULL,deadline TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,icon TEXT NOT NULL DEFAULT '',weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]');
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY,template_id TEXT REFERENCES templates(id),title TEXT NOT NULL,area TEXT NOT NULL,duration INTEGER NOT NULL,deadline TEXT NOT NULL,due_date TEXT NOT NULL,assignee_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'pending',completed_at TEXT,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,icon TEXT NOT NULL DEFAULT '',UNIQUE(template_id,due_date));
CREATE TABLE IF NOT EXISTS swaps (id TEXT PRIMARY KEY,task_a TEXT NOT NULL REFERENCES tasks(id),task_b TEXT NOT NULL REFERENCES tasks(id),requester_id TEXT NOT NULL REFERENCES users(id),recipient_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,resolved_at TEXT);
CREATE TABLE IF NOT EXISTS calendar_archives (id TEXT PRIMARY KEY,archived_at TEXT NOT NULL,archived_by TEXT NOT NULL REFERENCES users(id),task_count INTEGER NOT NULL,swap_count INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS weekly_draw_plans (week_start TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tasks_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS tasks_user ON tasks(assignee_id,status);
CREATE INDEX IF NOT EXISTS swaps_recipient ON swaps(recipient_id,status);
`);
// Older SQLite files retain their rows; add only the missing optional icon columns.
for (const table of ['templates', 'tasks']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'icon')) db.exec(`ALTER TABLE ${table} ADD COLUMN icon TEXT NOT NULL DEFAULT ''`);
}
if (!db.prepare('PRAGMA table_info(templates)').all().some(column => column.name === 'weekdays')) db.exec("ALTER TABLE templates ADD COLUMN weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]'");
const uid = () => randomBytes(12).toString('hex');
const hash = s => createHash('sha256').update(s).digest('hex');
const setupToken = randomBytes(24).toString('hex');
const one = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const profilePhotos = createPhotoStore(db, fail);
const settings = () => ({ ...defaultSettings, ...JSON.parse(one('SELECT value FROM settings WHERE id=1')?.value || '{}') });
const configured = () => !!one('SELECT id FROM users LIMIT 1');
const notifications = createNotifications({ db, settings });
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(value, label, max = 150) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label}: preencha um valor válido de até ${max} caracteres.`); return value.trim(); }
function email(value) { const v = text(value, 'E-mail', 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail('Informe um e-mail válido.'); return v; }
function phone(value) { if (typeof value !== 'string' || value.length > 30 || (value && !/^[+\d\s().-]{6,30}$/.test(value))) fail('Informe um telefone válido.'); return value.trim(); }
function password(value) { if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail('A senha deve ter entre 10 e 128 caracteres.'); const salt = randomBytes(16).toString('hex'); return { salt, digest: scryptSync(value, salt, 64).toString('hex') }; }
function activityIcon(value, existing, activity) {
    if (value === undefined) return existing?.icon || resolveActivityIcon(activity);
    if (!isActivityIcon(value)) fail('Escolha um ícone válido para a atividade.');
    return value;
}
function activityWeekdays(value, existing) {
    if (value === undefined) return existing ? templateWeekdays(existing) : [...ALL_WEEKDAYS];
    if (!Array.isArray(value) || !value.length || value.length > 7 || value.some(day => !Number.isInteger(day) || day < 0 || day > 6)) fail('Escolha ao menos um dia válido para esta atividade.');
    return [...new Set(value)].sort((a, b) => a - b);
}
function time(value) { if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('Informe um horário válido.'); return value; }
function date(value) { if (!validDate(value)) fail('Informe uma data válida.'); return value; }
function activeUser(id) { const user = one('SELECT * FROM users WHERE id=? AND active=1', id); if (!user) fail('Esse morador não está ativo.'); return user; }
function taskById(id) { const t = one('SELECT * FROM tasks WHERE id=?', id); if (!t) fail('Atividade não encontrada.', 404); return t; }
function requireAdmin(user) { if (user.role !== 'admin') fail('Esta ação é exclusiva da administração.', 403); }
function session(req) { const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('casa_session='))?.slice(13); if (!token) return null; return one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>? AND u.active=1', hash(token), Date.now()); }
function newSession(user, res, req) { const token = randomBytes(32).toString('hex'); run('DELETE FROM sessions WHERE expires<?', Date.now()); run('INSERT INTO sessions VALUES(?,?,?)', hash(token), user.id, Date.now() + 7 * 86400000); const secure = process.env.CASA_TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https'; res.setHeader('Set-Cookie', `casa_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`); }
function view(user) {
    const s = settings(); const now = localNow();
    const users = (user.role === 'admin' ? all('SELECT id,name,email,phone,role,active,password_hash IS NOT NULL AS registered FROM users ORDER BY name') : all('SELECT id,name,role,active FROM users ORDER BY name')).map(person => ({ ...person, photo_url: profilePhotos.photoUrl(person.id) }));
    return { notifications: notifications.status(user.id), archivedCalendars: user.role === 'admin' ? all('SELECT id,archived_at,archived_by,task_count,swap_count FROM calendar_archives ORDER BY archived_at DESC') : undefined, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, photo_url: profilePhotos.photoUrl(user.id) }, users, tasks: all('SELECT * FROM tasks ORDER BY due_date,deadline,title'), templates: all('SELECT * FROM templates ORDER BY title').map(template => ({ ...template, weekdays: templateWeekdays(template) })), swaps: all('SELECT * FROM swaps ORDER BY created_at DESC'), settings: s, holidays: nationalHolidays(Number(now.date.slice(0, 4))), now };
}
function generate(dates) {
    const s = settings(), people = all('SELECT id FROM users WHERE active=1 ORDER BY id'), templates = all('SELECT * FROM templates WHERE active=1');
    if (!people.length) fail('Cadastre ao menos um morador ativo.');
    if (!templates.length) fail('Cadastre uma atividade recorrente na administração.');
    const results = [], skipped = [], choices = [], today = localNow().date;
    const requested = [...new Set(dates)].filter(day => day >= today).sort();
    for (const day of requested) { const reason = offReason(day, s); if (reason) skipped.push({ date: day, reason }); }
    if (s.drawPeriod === 'weekly') {
        const requestedSet = new Set(requested);
        for (const week of new Set(requested.map(startOfWeek))) {
            const tasks = all('SELECT * FROM tasks WHERE due_date BETWEEN ? AND ?', week, addDays(week, 6));
            // Reconcile all saved slots against current settings/templates/tasks; cosmetic edits keep reservations.
            const prior = JSON.parse(one('SELECT data FROM weekly_draw_plans WHERE week_start=?', week)?.data || '[]');
            const slots = planWeeklySlots({ week, today, count: s.drawCount, templates, tasks, slots: prior, settings: s });
            run('INSERT INTO weekly_draw_plans(week_start,data) VALUES(?,?) ON CONFLICT(week_start) DO UPDATE SET data=excluded.data', week, JSON.stringify(slots));
            choices.push(...slots.filter(slot => requestedSet.has(slot.date)));
        }
    } else {
        for (const day of requested) {
            if (offReason(day, s)) continue;
            const existing = all('SELECT * FROM tasks WHERE due_date=?', day);
            const budget = s.drawPeriod === 'daily' ? Math.max(0, s.drawCount - existing.length) : Infinity;
            const eligible = templates.filter(template => templateEligible(template, day) && !existing.some(task => task.template_id === template.id));
            for (let i = eligible.length - 1; i > 0; i--) { const j = randomInt(i + 1);[eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
            choices.push(...eligible.slice(0, budget).map(template => ({ date: day, templateId: template.id })));
        }
    }
    const byTemplate = new Map(templates.map(template => [template.id, template]));
    for (const choice of choices.sort((a, b) => a.date.localeCompare(b.date))) {
        const day = choice.date, t = byTemplate.get(choice.templateId);
        if (!t || offReason(day, s) || !templateEligible(t, day) || one('SELECT id FROM tasks WHERE template_id=? AND due_date=?', t.id, day)) continue;
        const loads = new Map(people.map(person => [person.id, Number(one("SELECT count(*) AS n FROM tasks WHERE assignee_id=? AND substr(due_date,1,7)=? AND status!='paused'", person.id, day.slice(0, 7)).n)]));
        const min = Math.min(...loads.values()), candidates = people.filter(person => loads.get(person.id) === min), person = candidates[randomInt(candidates.length)], id = uid();
        run('INSERT INTO tasks(id,template_id,title,area,duration,deadline,due_date,assignee_id,created_at,icon) VALUES(?,?,?,?,?,?,?,?,?,?)', id, t.id, t.title, t.area, t.duration, t.deadline, day, person.id, new Date().toISOString(), resolveActivityIcon(t));
        results.push(taskById(id));
    }
    return { created: results, skipped };
} function synchronizePaused(s) {
    for (const t of all("SELECT * FROM tasks WHERE status IN ('pending','paused') AND due_date>=?", localNow().date)) run('UPDATE tasks SET status=? WHERE id=?', offReason(t.due_date, s) ? 'paused' : 'pending', t.id);
    for (const swap of all("SELECT * FROM swaps WHERE status='pending'")) if (!swappable(taskById(swap.task_a)) || !swappable(taskById(swap.task_b))) run("UPDATE swaps SET status='cancelled',resolved_at=? WHERE id=?", new Date().toISOString(), swap.id);
}
async function body(req, limit = 16384) { let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > limit) fail('Solicitação muito grande.', 413); } try { return JSON.parse(raw || '{}'); } catch { fail('Dados inválidos.'); } }
const attempts = new Map();
function rateLimit(req, label, max = 12) { const key = `${req.socket.remoteAddress}:${label}`, now = Date.now(); for (const [k, v] of attempts) if (v.until < now) attempts.delete(k); const a = attempts.get(key) || { count: 0, until: now + 900000 }; a.count++; attempts.set(key, a); if (a.count > max) fail('Muitas tentativas. Aguarde 15 minutos.', 429); }
function sameOrigin(req) { const origin = req.headers.origin; if (!origin) fail('A solicitação deve partir desta agenda.', 403); try { if (new URL(origin).host !== req.headers.host) fail('Origem não autorizada.', 403); } catch { fail('Origem não autorizada.', 403); } }
async function api(req, res, path) {
    if (req.method === 'GET' && path === '/api/bootstrap') return { configured: configured(), user: session(req) ? { id: session(req).id } : null };
    if (req.method === 'GET' && path === '/api/invite-info') { rateLimit(req, 'invite-info', 60); const token = new URL(req.url, 'http://localhost').searchParams.get('token') || ''; const u = one('SELECT name,email FROM users WHERE invite_hash=? AND invite_expires>? AND active=1', hash(token), Date.now()); if (!u) fail('O convite expirou ou já foi utilizado. Peça um novo ao admin.', 404); return u; }
    if (req.method !== 'GET') sameOrigin(req);
    const b = req.method === 'GET' ? {} : await body(req, path === '/api/profile-photo' ? 300 * 1024 : 16384);
    if (path === '/api/setup' && req.method === 'POST') return transaction(() => { if (configured()) fail('A casa já foi configurada.', 409); if (req.headers['x-setup-token'] !== setupToken) fail('Use o link de configuração exibido no terminal do servidor.', 403); const p = password(b.password), id = uid(); run('INSERT INTO users(id,name,email,phone,role,password_hash,password_salt) VALUES(?,?,?,?,?,?,?)', id, text(b.name, 'Nome', 70), email(b.email), phone(b.phone || ''), 'admin', p.digest, p.salt); const s = { ...defaultSettings, houseName: text(b.houseName, 'Nome da casa', 70) }; run('INSERT INTO settings VALUES(1,?)', JSON.stringify(s)); for (const [title, area, duration] of [['Limpar a cozinha', 'Cozinha', 20], ['Cuidar da sala', 'Sala', 15], ['Limpar o banheiro', 'Banheiro', 25], ['Recolher o lixo', 'Área de serviço', 10]]) run('INSERT INTO templates(id,title,area,duration,deadline,active,icon) VALUES(?,?,?,?,?,1,?)', uid(), title, area, duration, '20:00', resolveActivityIcon({ title, area })); const user = one('SELECT * FROM users WHERE id=?', id); newSession(user, res, req); return view(user); });
    if (path === '/api/login' && req.method === 'POST') { rateLimit(req, 'login'); const u = one('SELECT * FROM users WHERE email=? AND active=1', email(b.email)); if (typeof b.password !== 'string' || b.password.length > 128) fail('E-mail ou senha incorretos.', 401); const salt = u?.password_salt || 'invalid-salt', candidate = scryptSync(b.password, salt, 64); if (!u?.password_hash || !timingSafeEqual(candidate, Buffer.from(u.password_hash, 'hex'))) fail('E-mail ou senha incorretos.', 401); newSession(u, res, req); return view(u); }
    if (path === '/api/accept-invite' && req.method === 'POST') { rateLimit(req, 'accept'); return transaction(() => { const u = one('SELECT * FROM users WHERE invite_hash=? AND invite_expires>? AND active=1', hash(String(b.token || '')), Date.now()); if (!u) fail('Convite inválido ou expirado.'); const p = password(b.password); run('UPDATE users SET password_hash=?,password_salt=?,invite_hash=NULL,invite_expires=NULL WHERE id=?', p.digest, p.salt, u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); newSession(u, res, req); return view(u); }); }
    const user = session(req); if (!user) fail('Entre para acessar a agenda da casa.', 401);
    if (req.method === 'GET' && path === '/api/state') return view(user);
    if (req.method === 'GET' && path === '/api/export') { requireAdmin(user); return { exportedAt: new Date().toISOString(), ...view(user), archivedCalendars: all('SELECT * FROM calendar_archives ORDER BY archived_at DESC').map(archive => ({ ...archive, data: JSON.parse(archive.data) })) }; }
    if (req.method === 'POST' && path === '/api/notification-preferences') return transaction(() => {
        if (b.phone !== undefined) run('UPDATE users SET phone=? WHERE id=?', phone(b.phone), user.id);
        notifications.savePreferences(user.id, b);
        return view(one('SELECT * FROM users WHERE id=?', user.id));
    });
    if (req.method === 'POST' && path === '/api/push-device') return { subscribed: notifications.hasSubscription(user.id, b.endpoint) };
    if (req.method === 'POST' && path === '/api/push-subscribe') return transaction(() => {
        notifications.subscribe(user.id, b.subscription);
        return view(user);
    });
    if (req.method === 'POST' && path === '/api/push-unsubscribe') return transaction(() => {
        notifications.unsubscribe(user.id, b.endpoint);
        return view(user);
    });
    if (req.method === 'POST' && path === '/api/notification-test') {
        rateLimit(req, 'notification-test', 20);
        await notifications.sendTest(user.id, b.channel, b.endpoint);
        return { ok: true, message: 'Teste aceito pelo serviço de envio. O recebimento pode levar alguns instantes.' };
    }
    if (req.method === 'POST' && path === '/api/logout') { const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('casa_session='))?.slice(13); if (cookie) run('DELETE FROM sessions WHERE hash=?', hash(cookie)); res.setHeader('Set-Cookie', 'casa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true }; }
    if (req.method !== 'POST') fail('Página não encontrada.', 404);
    return transaction(() => {
        let extra = {};
        if (path === '/api/profile-photo') {
            const target = b.userId === undefined ? user.id : text(b.userId, 'Morador', 100);
            if (target !== user.id) requireAdmin(user);
            if (!one('SELECT id FROM users WHERE id=?', target)) fail('Morador não encontrado.', 404);
            profilePhotos.save(target, b.photo);
        } else if (path === '/api/complete') {
            const t = taskById(b.id); if (t.assignee_id !== user.id) fail('Apenas o responsável pode concluir esta atividade.', 403); if (t.status !== 'pending') fail('Esta atividade já foi concluída ou está pausada.', 409); if (t.due_date > localNow().date) fail('A atividade só pode ser concluída no dia agendado ou depois.');
            const points = award(t); run("UPDATE tasks SET status='done',completed_at=?,points=? WHERE id=? AND status='pending'", new Date().toISOString(), points, t.id); run("UPDATE swaps SET status='cancelled',resolved_at=? WHERE status='pending' AND (task_a=? OR task_b=?)", new Date().toISOString(), t.id, t.id); extra = { awarded: points };
        } else if (path === '/api/reset-calendar') {
            requireAdmin(user);
            if (b.confirmation !== 'ZERAR CALENDÁRIO') fail('Para zerar a agenda ativa, confirme digitando ZERAR CALENDÁRIO.');
            // Preserve the entire history in the SAME transaction before clearing active rows.
            // An archive failure rolls back the whole reset; archives are never deleted here.
            const snapshot = { tasks: all('SELECT * FROM tasks ORDER BY due_date,id'), swaps: all('SELECT * FROM swaps ORDER BY created_at,id') };
            const archiveId = snapshot.tasks.length || snapshot.swaps.length ? uid() : null;
            if (archiveId) run('INSERT INTO calendar_archives(id,archived_at,archived_by,task_count,swap_count,data) VALUES(?,?,?,?,?,?)', archiveId, new Date().toISOString(), user.id, snapshot.tasks.length, snapshot.swaps.length, JSON.stringify(snapshot));
            run('DELETE FROM swaps'); run('DELETE FROM tasks'); run('DELETE FROM weekly_draw_plans');
            run('UPDATE settings SET value=? WHERE id=1', JSON.stringify({ ...settings(), autoGenerate: false }));
            extra = { reset: { tasks: snapshot.tasks.length, swaps: snapshot.swaps.length } };
        } else if (path === '/api/draw') {
            requireAdmin(user); const d = date(b.date); if (d < localNow().date) fail('Escolha hoje ou uma data futura.'); if (d > String(Number(localNow().date.slice(0, 4)) + 1) + '-12-31') fail('Escolha uma data até o próximo ano.');
            if (b.month && b.week) fail('Escolha sortear a semana ou o mês.'); const dates = requestedDates(d, { month: !!b.month, week: !!b.week });
            extra = generate(dates);
        } else if (path === '/api/swap') {
            const a = taskById(b.taskA), c = taskById(b.taskB); if (a.assignee_id !== user.id || c.assignee_id === user.id) fail('Escolha uma atividade sua e uma de outro morador.', 403); activeUser(c.assignee_id); if (a.due_date.slice(0, 7) !== c.due_date.slice(0, 7)) fail('As atividades precisam pertencer ao mesmo mês.'); if (!swappable(a) || !swappable(c)) fail('Só é possível trocar atividades pendentes dentro do prazo.'); if (one("SELECT id FROM swaps WHERE status='pending' AND (task_a IN (?,?) OR task_b IN (?,?))", a.id, c.id, a.id, c.id)) fail('Uma das atividades já tem um pedido de troca pendente.', 409); run('INSERT INTO swaps(id,task_a,task_b,requester_id,recipient_id,created_at) VALUES(?,?,?,?,?,?)', uid(), a.id, c.id, user.id, c.assignee_id, new Date().toISOString());
        } else if (path === '/api/resolve-swap') {
            const s = one('SELECT * FROM swaps WHERE id=?', b.id); if (!s || s.status !== 'pending') fail('Este pedido já foi resolvido.', 409); if (!['accepted', 'rejected', 'cancelled'].includes(b.action)) fail('Resposta inválida.'); if (b.action === 'cancelled' ? s.requester_id !== user.id : s.recipient_id !== user.id) fail('Você não pode responder a este pedido.', 403);
            if (b.action === 'accepted') { const a = taskById(s.task_a), c = taskById(s.task_b); if (a.assignee_id !== s.requester_id || c.assignee_id !== s.recipient_id || !swappable(a) || !swappable(c)) fail('As atividades mudaram ou saíram do prazo. Peça uma nova troca.', 409); activeUser(a.assignee_id); activeUser(c.assignee_id); run('UPDATE tasks SET assignee_id=? WHERE id=?', c.assignee_id, a.id); run('UPDATE tasks SET assignee_id=? WHERE id=?', a.assignee_id, c.id); }
            run('UPDATE swaps SET status=?,resolved_at=? WHERE id=?', b.action, new Date().toISOString(), s.id);
        } else if (path === '/api/save-user') {
            requireAdmin(user); const id = b.id || uid(), name = text(b.name, 'Nome', 70), mail = email(b.email), tel = phone(b.phone || ''); const existing = one('SELECT * FROM users WHERE id=?', id); if (one('SELECT id FROM users WHERE email=? AND id!=?', mail, id)) fail('Este e-mail já está cadastrado.');
            if (existing) { if (id === user.id && b.active === false) fail('Você não pode desativar a própria conta.'); if (b.active === false && one("SELECT id FROM tasks WHERE assignee_id=? AND status IN ('pending','paused') LIMIT 1", id)) fail('Reatribua as atividades pendentes deste morador antes de desativá-lo.'); run('UPDATE users SET name=?,email=?,phone=?,active=? WHERE id=?', name, mail, tel, b.active === false ? 0 : 1, id); if (!b.active) run('DELETE FROM sessions WHERE user_id=?', id); } else { run('INSERT INTO users(id,name,email,phone) VALUES(?,?,?,?)', id, name, mail, tel); }
            if (existing) notifications.contactChanged(id, { emailChanged: mail !== existing.email, phoneChanged: tel !== existing.phone, deactivated: b.active === false });
            if (!existing) { const token = randomBytes(24).toString('hex'); run('UPDATE users SET invite_hash=?,invite_expires=? WHERE id=?', hash(token), Date.now() + 7 * 86400000, id); extra = { inviteToken: token }; }
        } else if (path === '/api/invite') {
            requireAdmin(user); if (b.id === user.id) fail('Use a própria sessão para alterar sua senha.'); activeUser(b.id); const token = randomBytes(24).toString('hex'); run('UPDATE users SET invite_hash=?,invite_expires=? WHERE id=?', hash(token), Date.now() + 7 * 86400000, b.id); extra = { inviteToken: token };
        } else if (path === '/api/settings') {
            requireAdmin(user); const old = settings(); if (!Array.isArray(b.disabledDays) || b.disabledDays.some(n => !Number.isInteger(n) || n < 0 || n > 6)) fail('Dias da semana inválidos.'); if (![15, 30, 60, 120].includes(Number(b.reminderMinutes))) fail('Escolha um intervalo de alertas válido.'); if (!b.holidays || typeof b.holidays !== 'object' || Array.isArray(b.holidays) || Object.keys(b.holidays).length > 100) fail('Datas de folga inválidas.'); for (const [d, n] of Object.entries(b.holidays)) { date(d); text(n, 'Nome do feriado', 70); }
            const drawPeriod = b.drawPeriod === undefined ? old.drawPeriod : b.drawPeriod, drawCount = b.drawCount === undefined ? old.drawCount : Number(b.drawCount);
            if (!['all', 'daily', 'weekly'].includes(drawPeriod)) fail('Escolha um período de sorteio válido.');
            if (!Number.isInteger(drawCount) || drawCount < 1 || drawCount > 100) fail('Escolha de 1 a 100 atividades por período.');
            const s = { ...old, drawPeriod, drawCount, houseName: text(b.houseName, 'Nome da casa', 70), disabledDays: [...new Set(b.disabledDays)], skipHolidays: !!b.skipHolidays, holidays: b.holidays, reminderMinutes: Number(b.reminderMinutes), paused: !!b.paused, autoGenerate: !!b.autoGenerate }; run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(s)); synchronizePaused(s);
        } else if (path === '/api/save-template') {
            requireAdmin(user); const id = b.id || uid(), existing = b.id ? one('SELECT * FROM templates WHERE id=?', id) : null, title = text(b.title, 'Atividade', 100), area = text(b.area, 'Ambiente', 40), duration = Number(b.duration), deadline = time(b.deadline), icon = activityIcon(b.icon, existing, { title, area }), weekdays = activityWeekdays(b.weekdays, existing); if (!Number.isInteger(duration) || duration < 1 || duration > 480) fail('A duração deve ser de 1 a 480 minutos.'); run('INSERT INTO templates(id,title,area,duration,deadline,active,icon,weekdays) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,area=excluded.area,duration=excluded.duration,deadline=excluded.deadline,active=excluded.active,icon=excluded.icon,weekdays=excluded.weekdays', id, title, area, duration, deadline, b.active === false ? 0 : 1, icon, JSON.stringify(weekdays));
        } else if (path === '/api/save-task') {
            requireAdmin(user); const id = b.id || uid(), existing = b.id ? taskById(id) : null; if (existing?.status === 'done') fail('Atividades concluídas preservam seu histórico.'); const day = date(b.due_date); if (day < localNow().date) fail('Escolha hoje ou uma data futura.'); const reason = offReason(day, settings()); if (reason && (!existing || existing.due_date !== day)) fail('Esse dia está desativado para limpeza.'); activeUser(b.assignee_id); const duration = Number(b.duration); if (!Number.isInteger(duration) || duration < 1 || duration > 480) fail('Informe uma duração entre 1 e 480 minutos.'); const title = text(b.title, 'Atividade', 100), area = text(b.area, 'Ambiente', 40), icon = activityIcon(b.icon, existing, { title, area }); run('INSERT INTO tasks(id,title,area,duration,deadline,due_date,assignee_id,created_at,status,icon) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,area=excluded.area,duration=excluded.duration,deadline=excluded.deadline,due_date=excluded.due_date,assignee_id=excluded.assignee_id,status=excluded.status,icon=excluded.icon', id, title, area, duration, time(b.deadline), day, b.assignee_id, new Date().toISOString(), reason ? 'paused' : 'pending', icon); run("UPDATE swaps SET status='cancelled',resolved_at=? WHERE status='pending' AND (task_a=? OR task_b=?)", new Date().toISOString(), id, id);
        } else if (path === '/api/change-password') {
            if (typeof b.currentPassword !== 'string' || b.currentPassword.length > 128 || !timingSafeEqual(scryptSync(b.currentPassword, user.password_salt, 64), Buffer.from(user.password_hash, 'hex'))) fail('A senha atual está incorreta.'); const p = password(b.password); run('UPDATE users SET password_hash=?,password_salt=? WHERE id=?', p.digest, p.salt, user.id); run('DELETE FROM sessions WHERE user_id=?', user.id); newSession(user, res, req);
        } else fail('Ação não encontrada.', 404);
        return { ...view(one('SELECT * FROM users WHERE id=?', user.id)), ...extra };
    });
}
const apiOnly = process.argv.includes('--api-only');
const development = process.argv.includes('--dev');
const port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0';
let nextApp = null, handleNext = null;
if (!apiOnly) {
    process.env.NODE_ENV = development ? 'development' : 'production';
    try {
        const { default: next } = await import('next');
        nextApp = next({ dev: development, dir: root, hostname: host, port });
        await nextApp.prepare();
        handleNext = nextApp.getRequestHandler();
    } catch (error) {
        console.error('Não foi possível iniciar o Next.js:', error.message);
        console.error('Instale as dependências com npm ci e execute npm run build antes de npm start. Para desenvolver, use npm run dev.');
        db.close(); process.exit(1);
    }
}
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'" + (development ? " 'unsafe-eval'" : "") + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'" + (development ? " ws: wss:" : "") + "; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Content-Security-Policy', csp);
    try {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path === '/api/profile-photo' && req.method === 'GET') {
            const user = session(req); if (!user) fail('Entre para acessar a foto do morador.', 401);
            const query = new URL(req.url, 'http://localhost').searchParams, id = query.get('id') || user.id;
            const photo = profilePhotos.read(id); if (!photo) fail('Foto não encontrada.', 404);
            res.setHeader('Cache-Control', query.get('v') === photo.version ? 'private, max-age=86400' : 'private, no-store');
            res.writeHead(200, { 'Content-Type': photo.mime }); res.end(photo.data); return;
        }
        if (path.startsWith('/api/')) {
            res.setHeader('Cache-Control', 'no-store');
            const result = await api(req, res, path);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result)); return;
        }
        if (path === '/sw.js') { res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Service-Worker-Allowed', '/'); }
        if (handleNext) { await handleNext(req, res); return; }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Página não encontrada.');
    } catch (error) {
        if (!error.status) console.error('Erro interno:', error.message);
        if (res.headersSent) { res.end(); return; }
        res.writeHead(error.status || 500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.status ? error.message : 'Não foi possível concluir. Tente novamente.' }));
    }
});
if (nextApp) server.on('upgrade', (req, socket, head) => nextApp.getUpgradeHandler()(req, socket, head));
function automaticGeneration() {
    if (!configured()) return;
    try {
        transaction(() => {
            for (const swap of all("SELECT * FROM swaps WHERE status='pending'")) if (!swappable(taskById(swap.task_a)) || !swappable(taskById(swap.task_b))) run("UPDATE swaps SET status='cancelled',resolved_at=? WHERE id=?", new Date().toISOString(), swap.id);
            if (settings().autoGenerate) generate([localNow().date]);
        });
    } catch (error) { console.error('Geração diária:', error.message); }
}
async function maintenance() {
    automaticGeneration();
    try { await notifications.tick(); } catch { console.error('Não foi possível processar os lembretes. Confira o estado dos canais na agenda.'); }
}
const timer = setInterval(() => { void maintenance(); }, 60000); timer.unref();
server.listen(port, host, () => {
    console.log('\nCasa em Dia · http://localhost:' + server.address().port);
    if (!configured()) console.log('Configure sua casa: http://localhost:' + server.address().port + '/?configurar=' + setupToken + '\nGuarde esse link até criar o administrador. Não o compartilhe.');
    for (const net of Object.values(networkInterfaces()).flat()) if (net.family === 'IPv4' && !net.internal) console.log('Na mesma rede Wi-Fi: http://' + net.address + ':' + server.address().port);
    void maintenance();
});
server.on('error', async error => { console.error('Não foi possível abrir a porta do servidor:', error.message); clearInterval(timer); await notifications.stop(); db.close(); process.exit(1); });
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    if (shuttingDown) return; shuttingDown = true; clearInterval(timer);
    server.close(async () => { try { await notifications.stop(); await nextApp?.close(); } finally { db.close(); process.exit(0); } });
    server.closeIdleConnections();
});
