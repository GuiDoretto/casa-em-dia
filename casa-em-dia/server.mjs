import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { loadEnvFile } from 'node:process';
import { createHouseApplication } from './application.mjs';

const root = dirname(fileURLToPath(import.meta.url));
try { loadEnvFile(resolve(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const dataDir = resolve(process.env.CASA_DATA_DIR || resolve(root, '.data'));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'casa.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
const { api, profilePhotos, session, configured, setupToken, notifications, automaticGeneration, fail } = createHouseApplication({ db });

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
