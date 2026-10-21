import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false' };
for (const name of ['BREVO_API_KEY', 'CASA_SETUP_TOKEN', 'CASA_MIGRATION_TOKEN', 'CASA_ADMIN_BOOTSTRAP', 'CASA_ADMIN_PASSWORD', 'CLOUDFLARE_API_TOKEN']) delete env[name];

function run(script, args, extra = {}) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], { cwd: root, env: { ...env, ...extra }, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run('node_modules/next/dist/bin/next', ['build'], { CASA_STATIC_EXPORT: '1' });
run('node_modules/wrangler/bin/wrangler.js', ['deploy', '--dry-run', '--outdir', 'work/cloudflare-bundle']);
