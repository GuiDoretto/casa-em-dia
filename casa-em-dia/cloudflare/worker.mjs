import { DurableObject } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createHouseApplication } from '../application.mjs';
import { createDurableSqliteDatabase, createPersistentRateLimiter } from './sqlite-adapter.mjs';
import { createFetchPushClient } from './push-client.mjs';
import { nodeRequest, readJson, securityHeaders, withSecurity } from './http.mjs';
import { compareManifests, exportSnapshot, getManifest, importSnapshot } from './data-transfer.mjs';

function errorResponse(error) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  if (status === 500) console.error(JSON.stringify({ event: 'request_failed', type: error.name || 'Error' }));
  return Response.json({ error: status === 500 ? 'Não foi possível concluir a solicitação. Tente novamente.' : error.message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export class CasaDatabase extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.runtimeEnv = { ...env, CASA_TRUST_PROXY: '1' };
    this.db = createDurableSqliteDatabase(ctx.storage);
    this.pushClient = createFetchPushClient();
    this.db.transaction(() => {
      this.rateLimit = createPersistentRateLimiter(this.db);
      this.createApplication();
      this.db.exec('CREATE TABLE IF NOT EXISTS _casa_schema_migrations (version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
      this.db.prepare('INSERT OR IGNORE INTO _casa_schema_migrations(version,applied_at) VALUES(1,?)').run(new Date().toISOString());
    });
  }

  createApplication() {
    this.application = this.buildApplication();
  }

  buildApplication() {
    return createHouseApplication({
      db: this.db,
      env: this.runtimeEnv,
      setupToken: this.runtimeEnv.CASA_SETUP_TOKEN || '',
      transaction: callback => this.db.transaction(callback),
      rateLimit: this.rateLimit,
      notificationOptions: { pushClient: this.pushClient },
    });
  }

  authorizeAdministration(request) {
    if (this.env.CASA_MIGRATION_ENABLED !== '1') throw Object.assign(new Error('Rota não encontrada.'), { status: 404 });
    const secret = this.env.CASA_MIGRATION_TOKEN;
    const supplied = request.headers.get('Authorization') || '';
    if (typeof secret !== 'string' || secret.length < 32 || supplied.length > 1100 || !supplied.startsWith('Bearer ')) throw Object.assign(new Error('Acesso administrativo não autorizado.'), { status: 401 });
    const digest = value => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(secret), digest(supplied.slice(7)))) throw Object.assign(new Error('Acesso administrativo não autorizado.'), { status: 401 });
  }

  async administration(request, path) {
    this.authorizeAdministration(request);
    await this.application.notifications.stop();
    if (path === '/__admin/manifest' && request.method === 'GET') return Response.json(getManifest(this.db));
    if (path === '/__admin/export' && request.method === 'GET') return Response.json(exportSnapshot(this.db));
    if (path === '/__admin/import' && request.method === 'POST') {
      const snapshot = await readJson(request, 8 * 1024 * 1024);
      let replacement;
      const manifest = importSnapshot(this.db, snapshot, {
        transaction: callback => this.db.transaction(() => {
          const result = callback();
          replacement = this.buildApplication();
          if (!compareManifests(result, getManifest(this.db)).equal) throw Object.assign(new Error('A inicialização alteraria o backup importado. A operação foi revertida.'), { status: 400 });
          return result;
        }),
      });
      // Publish the imported VAPID and services only after the complete SQL
      // transaction, including initialization checks, has committed successfully.
      this.application = replacement;
      console.log(JSON.stringify({ event: 'import_verified', tables: 13 }));
      return Response.json(manifest);
    }
    throw Object.assign(new Error('Rota não encontrada.'), { status: 404 });
  }

  async fetch(request) {
    const url = new URL(request.url);
    let response;
    try {
      if (!this.runtimeEnv.CASA_PUBLIC_URL) {
        this.runtimeEnv.CASA_PUBLIC_URL = url.origin;
        this.createApplication();
      }
      if (url.pathname.startsWith('/__admin/')) response = await this.administration(request, url.pathname);
      else {
        if (request.method !== 'GET' && request.method !== 'HEAD' && this.env.CASA_MIGRATION_ENABLED === '1') throw Object.assign(new Error('A agenda está em manutenção para preservar os dados. Tente novamente em instantes.'), { status: 503 });
        const req = nodeRequest(request), headers = new Headers({ 'Cache-Control': 'no-store' });
        const res = { setHeader(name, value) { headers.set(name, String(value)); } };
        if (url.pathname === '/api/profile-photo' && ['GET', 'HEAD'].includes(request.method)) {
          const user = this.application.session(req);
          if (!user) throw Object.assign(new Error('Entre para acessar a agenda da casa.'), { status: 401 });
          const photo = this.application.profilePhotos.read(url.searchParams.get('id') || user.id);
          if (!photo) throw Object.assign(new Error('Foto não encontrada.'), { status: 404 });
          headers.set('Content-Type', photo.mime);
          headers.set('Cache-Control', url.searchParams.get('v') === photo.version ? 'private, max-age=86400' : 'private, no-store');
          headers.set('ETag', '"' + photo.version + '"');
          response = new Response(request.method === 'HEAD' ? null : photo.data, { headers });
        } else {
          const result = await this.application.api(req, res, url.pathname);
          response = Response.json(result, { headers });
        }
      }
    } catch (error) { response = errorResponse(error); }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', headers.get('Cache-Control') || 'no-store');
    return withSecurity(new Response(response.body, { status: response.status, headers }), request);
  }

  async runMaintenance() {
    if (this.env.CASA_SCHEDULE_ENABLED !== '1' || this.env.CASA_MIGRATION_ENABLED === '1') return { skipped: true };
    this.application.automaticGeneration();
    await this.application.notifications.tick();
    return { ok: true };
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/__admin/')) return env.CASA.getByName('principal').fetch(request);
    if (!['GET', 'HEAD'].includes(request.method)) return withSecurity(Response.json({ error: 'Método não permitido.' }, { status: 405 }), request);
    const response = await env.ASSETS.fetch(request);
    const headers = securityHeaders(response.headers, new URL(request.url).protocol === 'https:');
    if (path === '/sw.js') headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
  scheduled(_controller, env, ctx) {
    if (env.CASA_SCHEDULE_ENABLED === '1' && env.CASA_MIGRATION_ENABLED !== '1') ctx.waitUntil(env.CASA.getByName('principal').runMaintenance());
  },
};
