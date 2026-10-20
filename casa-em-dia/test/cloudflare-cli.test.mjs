import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createHouseApplication } from '../application.mjs';
import { compareManifests, exportSnapshot, validateSnapshot } from '../cloudflare/data-transfer.mjs';

const root = resolve(import.meta.dirname, '..');
const token = 'local-cli-test-token-not-a-production-secret';

function command(args) {
  return new Promise((yes, no) => {
    const child = spawn(process.execPath, ['scripts/cloudflare-data.mjs', ...args], { cwd: root, windowsHide: true, env: { ...process.env, CASA_MIGRATION_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.once('error', no); child.once('close', code => yes({ code, stdout, stderr }));
  });
}

function files(t, close = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'casa-cli-test-'));
  const name = 'test-cli-' + process.pid + '-' + randomBytes(6).toString('hex');
  const copied = resolve(root, 'backups', name + '.sqlite'), snapshot = copied.replace(/\.sqlite$/, '.json');
  t.after(() => {
    close();
    for (const path of [copied, copied + '-wal', copied + '-shm', snapshot]) {
      if (dirname(path) !== resolve(root, 'backups') || !basename(path).startsWith('test-cli-')) throw new Error('Caminho de limpeza inesperado.');
      if (existsSync(path)) rmSync(path);
    }
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('casa-cli-test-')) throw new Error('Pasta temporária inesperada.');
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  return { directory, copied, snapshot };
}

test('CLI faz backup consistente com WAL ativo sem alterar a origem e verifica todas as tabelas', async t => {
  let db;
  const paths = files(t, () => db?.close()), source = join(paths.directory, 'original.sqlite');
  db = new DatabaseSync(source);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=0');
  createHouseApplication({ db, env: {}, setupToken: '' });
  db.prepare("INSERT INTO users(id,name,email,role) VALUES('cli','Teste CLI','cli@example.test','admin')").run();
  const expected = exportSnapshot(db);
  const before = readFileSync(source + '-wal'), version = db.prepare('PRAGMA data_version').get().data_version;
  assert.ok(statSync(source + '-wal').size > 0);
  const result = await command(['backup', '--source', source, '--out', paths.copied]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(readFileSync(source + '-wal'), before);
  assert.equal(db.prepare('PRAGMA data_version').get().data_version, version);
  const snapshot = JSON.parse(readFileSync(paths.snapshot, 'utf8'));
  validateSnapshot(snapshot);
  assert.ok(compareManifests(expected.manifest, snapshot.manifest).equal);
  const privateKey = JSON.parse(db.prepare("SELECT value FROM notification_meta WHERE key='vapid'").get().value).privateKey;
  assert.equal(result.stdout.includes(privateKey), false);
  const verified = await command(['verify', '--file', paths.snapshot]);
  assert.equal(verified.code, 0, verified.stderr);
  const repeated = await command(['backup', '--source', source, '--out', paths.copied]);
  assert.notEqual(repeated.code, 0);
  assert.ok(compareManifests(snapshot.manifest, JSON.parse(readFileSync(paths.snapshot, 'utf8')).manifest).equal);
});

test('CLI baixa snapshot integral autenticado, confere manifesto remoto e recusa tokens por argumento', async t => {
  let db;
  const paths = files(t, () => db?.close()); db = new DatabaseSync(':memory:');
  createHouseApplication({ db, env: {}, setupToken: '' });
  const snapshot = exportSnapshot(db);
  const server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer ' + token) { response.writeHead(401); response.end('{}'); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/__admin/export' ? snapshot : snapshot.manifest));
  });
  await new Promise(yes => server.listen(0, '127.0.0.1', yes));
  t.after(() => new Promise(yes => server.close(yes)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const downloaded = await command(['download', '--url', url, '--out', paths.snapshot]);
  assert.equal(downloaded.code, 0, downloaded.stderr);
  assert.ok(compareManifests(snapshot.manifest, JSON.parse(readFileSync(paths.snapshot, 'utf8')).manifest).equal);
  const verified = await command(['verify', '--file', paths.snapshot, '--url', url]);
  assert.equal(verified.code, 0, verified.stderr);
  const invalid = await command(['download', '--url', url, '--token', token]);
  assert.notEqual(invalid.code, 0);
  assert.equal(invalid.stdout.includes(token) || invalid.stderr.includes(token), false);
});
