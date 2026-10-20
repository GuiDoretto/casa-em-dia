import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--url') throw new Error('Uso: node scripts/cloudflare-secrets.mjs --url https://SEU_WORKER.workers.dev');
const url = new URL(args[1]);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use somente a origem HTTPS da aplicação, sem credenciais ou caminhos.');

const localEnv = resolve(root, '.env'), migrationEnv = resolve(root, '.env.migration');
if (existsSync(localEnv)) loadEnvFile(localEnv);
if (existsSync(migrationEnv)) loadEnvFile(migrationEnv);
let token = process.env.CASA_MIGRATION_TOKEN;
if (!token) {
  token = randomBytes(32).toString('hex');
  writeFileSync(migrationEnv, 'CASA_MIGRATION_TOKEN=' + token + '\n', { flag: 'wx', mode: 0o600 });
}
if (token.length < 32 || /[\r\n]/.test(token)) throw new Error('O token de migração precisa ter ao menos 32 caracteres.');
const secrets = { CASA_MIGRATION_TOKEN: token, CASA_PUBLIC_URL: url.origin };
if (process.env.BREVO_API_KEY) secrets.BREVO_API_KEY = process.env.BREVO_API_KEY;
if (process.env.BREVO_FROM_EMAIL) secrets.BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL;

// Secrets travel through stdin to the official CLI, never command arguments or
// versioned files. Wrangler only reports names, not the values supplied here.
const child = spawn(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'secret', 'bulk'], {
  cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, windowsHide: true,
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.end(JSON.stringify(secrets));
child.once('error', () => { console.error('Não foi possível iniciar o Wrangler. Nenhum segredo foi exibido.'); process.exitCode = 1; });
child.once('exit', code => {
  process.exitCode = code === 0 ? 0 : 1;
  if (code === 0) console.log('Segredos enviados sem exibir seus valores. Preserve o token operacional no ambiente ou no arquivo local ignorado .env.migration.');
});
