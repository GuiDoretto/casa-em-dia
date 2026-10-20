#!/usr/bin/env node
import { DatabaseSync, backup } from 'node:sqlite';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { MAX_SNAPSHOT_BYTES, compareManifests, exportSnapshot, getManifest, validateSnapshot } from '../cloudflare/data-transfer.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backupRoot = resolve(projectRoot, 'backups');
const usage = `Uso:
  node scripts/cloudflare-data.mjs backup [--source .data/casa.sqlite] [--out backups/NOME.sqlite]
  node scripts/cloudflare-data.mjs export --source backups/NOME.sqlite [--out backups/NOME.json]
  node scripts/cloudflare-data.mjs verify --file backups/NOME.json [--url https://agenda.exemplo]
  node scripts/cloudflare-data.mjs import --file backups/NOME.json --url https://agenda.exemplo
  node scripts/cloudflare-data.mjs download --url https://agenda.exemplo [--out backups/ONLINE.json]
  node scripts/cloudflare-data.mjs manifest --source backups/NOME.sqlite

O token remoto é lido somente de CASA_MIGRATION_TOKEN no ambiente.
Opcional: --env-file .env (leitura explícita; nenhum segredo é exibido).
O backup consistente e seus snapshots ficam em backups/, ignorado pelo Git.
Importação exige destino vazio e usa os mesmos IDs, senhas, fotos e chaves VAPID.
`;

function fail(message) { throw new Error(message); }
function parseArguments(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return { command: 'help' };
  const [command, ...rest] = argv;
  if (!['backup', 'export', 'verify', 'import', 'manifest', 'download'].includes(command)) fail('Comando desconhecido. Use --help.');
  const options = { command };
  const allowed = { backup: ['source', 'out'], export: ['source', 'out'], verify: ['file', 'url'], import: ['file', 'url'], manifest: ['source'], download: ['url', 'out'] }[command];
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]?.slice(2), value = rest[i + 1];
    if (!rest[i]?.startsWith('--') || ![...allowed, 'env-file'].includes(name) || !value || value.startsWith('--') || options[name] !== undefined) fail('Opção inválida ou repetida. Use --help; tokens não são aceitos por argumento.');
    options[name] = value;
  }
  return options;
}

function privateOutput(path) {
  const absolute = resolve(projectRoot, path), child = relative(backupRoot, absolute);
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) fail('O destino deve ficar dentro da pasta backups/ do projeto.');
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  if (existsSync(absolute)) fail('O arquivo de destino já existe. Escolha outro nome; backups anteriores são preservados.');
  return absolute;
}

function backupInput(path) {
  if (!path) fail('Informe --source apontando para uma cópia SQLite em backups/.');
  const absolute = resolve(projectRoot, path), child = relative(backupRoot, absolute);
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) fail('Exporte somente uma cópia em backups/. Execute primeiro o comando backup para obter uma cópia consistente.');
  if (!statSync(absolute).isFile()) fail('A cópia SQLite informada não é um arquivo.');
  return absolute;
}

function summary(manifest) {
  return { sha256: manifest.sha256, counts: Object.fromEntries(manifest.tables.map(table => [table.name, table.count])) };
}

function readSnapshot(path) {
  if (!path) fail('Informe --file com o snapshot JSON completo.');
  const absolute = resolve(projectRoot, path);
  if (statSync(absolute).size > MAX_SNAPSHOT_BYTES) fail('O snapshot excede 8 MiB. Planeje a transferência em partes, sem truncar registros.');
  let value;
  try { value = JSON.parse(readFileSync(absolute, 'utf8')); } catch { fail('Não foi possível interpretar o snapshot JSON.'); }
  validateSnapshot(value);
  return value;
}

function snapshotFromCopy(source) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') fail('A verificação de integridade da cópia SQLite falhou.');
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length) fail('A cópia SQLite contém referências órfãs. Nenhum envio foi realizado.');
    return exportSnapshot(db);
  } finally { db.close(); }
}

function saveSnapshot(snapshot, path) {
  const target = privateOutput(path);
  writeFileSync(target, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
  return target;
}

function remoteTarget(value) {
  if (!value) fail('Informe --url com o endereço da aplicação Cloudflare.');
  let url;
  try { url = new URL(value); } catch { fail('Endereço remoto inválido.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) fail('Use HTTPS e a origem da aplicação, sem credenciais, caminho, query ou fragmento. HTTP é permitido somente em localhost.');
  const token = process.env.CASA_MIGRATION_TOKEN;
  if (!token || token.length < 32 || /[\r\n]/.test(token)) fail('Defina CASA_MIGRATION_TOKEN no ambiente com pelo menos 32 caracteres. Não passe o token na linha de comando.');
  return { origin: url.origin, token };
}

async function remoteRequest(target, path, snapshot) {
  let response;
  try {
    response = await fetch(target.origin + path, {
      method: snapshot ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + target.token, ...(snapshot ? { 'Content-Type': 'application/json' } : {}) },
      ...(snapshot ? { body: JSON.stringify(snapshot) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(60000),
    });
  } catch { fail('Não foi possível acessar a aplicação. Confira o endereço e a conexão. Nenhum token ou registro foi exibido.'); }
  if (!response.ok) fail(`O servidor recusou a operação (HTTP ${response.status}). Confira o token, a habilitação da migração e se o destino está vazio.`);
  try { return await response.json(); } catch { fail('O servidor retornou uma resposta inválida.'); }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.command === 'help') { console.log(usage); return; }
  if (options['env-file']) {
    const envPath = resolve(projectRoot, options['env-file']);
    if (basename(envPath) === '.env.example') fail('Use um arquivo privado .env; o modelo .env.example não é uma fonte de credenciais.');
    loadEnvFile(envPath);
  }
  if (options.command === 'backup') {
    const source = resolve(projectRoot, options.source || resolve(process.env.CASA_DATA_DIR || resolve(projectRoot, '.data'), 'casa.sqlite'));
    if (!statSync(source).isFile()) fail('O banco de origem informado não é um arquivo.');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const output = privateOutput(options.out || `backups/casa-${stamp}.sqlite`);
    if (extname(output) !== '.sqlite') fail('O backup deve usar a extensão .sqlite.');
    const snapshotPath = output.slice(0, -7) + '.json';
    if (existsSync(snapshotPath)) fail('Já existe um snapshot com esse nome. Escolha outro nome de backup.');
    // Reserve the output exclusively; sqlite backup writes only this new file.
    closeSync(openSync(output, 'wx', 0o600));
    const sourceDb = new DatabaseSync(source, { readOnly: true });
    try { await backup(sourceDb, output); } finally { sourceDb.close(); }
    chmodSync(output, 0o600);
    const snapshot = snapshotFromCopy(output);
    saveSnapshot(snapshot, snapshotPath);
    console.log(JSON.stringify({ ok: true, backup: output, snapshot: snapshotPath, ...summary(snapshot.manifest) }, null, 2));
    return;
  }
  if (options.command === 'export' || options.command === 'manifest') {
    const source = backupInput(options.source);
    const snapshot = snapshotFromCopy(source);
    if (options.command === 'manifest') { console.log(JSON.stringify(summary(snapshot.manifest), null, 2)); return; }
    const target = saveSnapshot(snapshot, options.out || source.replace(/\.[^.]+$/, '') + '-export.json');
    console.log(JSON.stringify({ ok: true, snapshot: target, ...summary(snapshot.manifest) }, null, 2));
    return;
  }
  if (options.command === 'download') {
    const snapshot = await remoteRequest(remoteTarget(options.url), '/__admin/export');
    validateSnapshot(snapshot);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = saveSnapshot(snapshot, options.out || `backups/online-${stamp}.json`);
    console.log(JSON.stringify({ ok: true, snapshot: target, ...summary(snapshot.manifest) }, null, 2));
    return;
  }
  const snapshot = readSnapshot(options.file);
  if (options.command === 'verify') {
    if (options.url) {
      const remote = await remoteRequest(remoteTarget(options.url), '/__admin/manifest');
      const comparison = compareManifests(snapshot.manifest, remote.manifest || remote);
      if (!comparison.equal) fail(comparison.differences.join(' '));
    }
    console.log(JSON.stringify({ ok: true, verified: options.url ? 'local-e-remoto' : 'local', ...summary(snapshot.manifest) }, null, 2));
    return;
  }
  const target = remoteTarget(options.url);
  const result = await remoteRequest(target, '/__admin/import', snapshot);
  const comparison = compareManifests(snapshot.manifest, result.manifest || result);
  if (!comparison.equal) fail('A importação respondeu, mas o manifesto não corresponde ao backup. Mantenha o agendador desligado e confira o destino.');
  const verified = await remoteRequest(target, '/__admin/manifest');
  if (!compareManifests(snapshot.manifest, verified.manifest || verified).equal) fail('A conferência independente após importação falhou. Mantenha o agendador desligado.');
  console.log(JSON.stringify({ ok: true, imported: true, verified: true, ...summary(snapshot.manifest) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Operação interrompida: ' + error.message); process.exitCode = 1; });
}
