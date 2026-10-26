import { createECDH, createHash } from 'node:crypto';

export const SNAPSHOT_FORMAT = 'casa-em-dia.snapshot.v2';
export const MANIFEST_FORMAT = 'casa-em-dia.manifest.v2';
const LEGACY_SNAPSHOT_FORMAT = 'casa-em-dia.snapshot.v1';
const LEGACY_MANIFEST_FORMAT = 'casa-em-dia.manifest.v1';
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_ROW_BYTES = 2_000_000;

const table = (name, fields, primaryKey, foreignKeys = []) => ({
  name,
  columns: fields.map(([name]) => name),
  fields: fields.map(([name, type, nullable = false]) => ({ name, type, nullable })),
  primaryKey,
  blobColumns: fields.filter(([, type]) => type === 'blob').map(([name]) => name),
  foreignKeys,
});
const T = (name, nullable = false) => [name, 'text', nullable];
const I = (name, nullable = false) => [name, 'integer', nullable];
const ref = (column, table, target = 'id') => ({ column, table, target });

// Parent tables precede their children. Internal Durable Object tables are excluded.
export const TABLES = [
  table('users', [T('id'), T('name'), T('email'), T('phone'), T('role'), I('active'), T('password_hash', true), T('password_salt', true), T('invite_hash', true), I('invite_expires', true)], ['id']),
  table('settings', [I('id'), T('value')], ['id']),
  table('templates', [T('id'), T('title'), T('area'), I('duration'), T('deadline'), I('active'), T('icon'), T('weekdays')], ['id']),
  table('tasks', [T('id'), T('template_id', true), T('title'), T('area'), I('duration'), T('deadline'), T('due_date'), T('assignee_id'), T('status'), T('completed_at', true), I('points'), T('created_at'), T('icon')], ['id'], [ref('template_id', 'templates'), ref('assignee_id', 'users')]),
  table('sessions', [T('hash'), T('user_id'), I('expires')], ['hash'], [ref('user_id', 'users')]),
  table('swaps', [T('id'), T('task_a'), T('task_b'), T('requester_id'), T('recipient_id'), T('status'), T('created_at'), T('resolved_at', true)], ['id'], [ref('task_a', 'tasks'), ref('task_b', 'tasks'), ref('requester_id', 'users'), ref('recipient_id', 'users')]),
  table('calendar_archives', [T('id'), T('archived_at'), T('archived_by'), I('task_count'), I('swap_count'), T('data')], ['id'], [ref('archived_by', 'users')]),
  table('weekly_draw_plans', [T('week_start'), T('data')], ['week_start']),
  table('profile_photos', [T('user_id'), T('mime'), ['data', 'blob'], T('version')], ['user_id'], [ref('user_id', 'users')]),
  table('notification_meta', [T('key'), T('value')], ['key']),
  table('notification_preferences', [T('user_id'), I('email_enabled'), I('sms_enabled'), T('reminder_time')], ['user_id'], [ref('user_id', 'users')]),
  table('notification_subscriptions', [T('endpoint'), T('user_id'), T('subscription'), I('created_at')], ['endpoint'], [ref('user_id', 'users')]),
  table('notification_deliveries', [T('id'), T('delivery_key'), T('user_id'), T('channel'), T('endpoint'), T('status'), I('created_at'), I('updated_at'), I('attempts'), I('next_attempt'), T('error', true), T('kind')], ['id'], [ref('user_id', 'users')]),
  table('rooms', [T('id'), T('name'), I('rent_cents'), T('features'), T('resident_id', true)], ['id'], [ref('resident_id', 'users')]),
  table('monthly_expenses', [T('id'), T('month'), T('description'), I('amount_cents')], ['id']),
  table('monthly_bills', [T('id'), T('month'), T('user_id'), T('resident_name'), T('room_name'), I('rent_cents'), I('shared_cents'), I('total_cents'), T('expenses'), T('generated_at')], ['id'], [ref('user_id', 'users')]),
];
const LEGACY_TABLES = TABLES.slice(0, 13);

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const json = value => JSON.stringify(value);
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : json(value), 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => json(a) === json(b);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort());
const quoted = name => '"' + name + '"';
const keyOf = (definition, row) => json(definition.primaryKey.map(column => row[definition.columns.indexOf(column)]));

function encodeValue(value, field, tableName) {
  if (value === null) return null;
  if (field.type === 'blob') {
    if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) fail(`BLOB inválido em ${tableName}.${field.name}.`);
    return { $blob: Buffer.from(value).toString('base64') };
  }
  return value;
}

function validateValue(value, field, tableName) {
  const label = `${tableName}.${field.name}`;
  if (value === null) { if (!field.nullable) fail(`Valor nulo não permitido em ${label}.`); return; }
  if (field.type === 'text' && typeof value !== 'string') fail(`Texto inválido em ${label}.`);
  if (field.type === 'integer' && !Number.isSafeInteger(value)) fail(`Inteiro inválido ou fora da precisão segura em ${label}.`);
  if (field.type === 'blob') {
    if (!exactKeys(value, ['$blob']) || typeof value.$blob !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.$blob) || Buffer.from(value.$blob, 'base64').toString('base64') !== value.$blob) fail(`Base64 inválido em ${label}.`);
  }
}

function canonicalTables(tables, definitions = TABLES) {
  return definitions.map(definition => {
    const source = tables.find(value => value.name === definition.name);
    const rows = source.rows.map(row => [...row]);
    rows.sort((a, b) => { const ka = keyOf(definition, a), kb = keyOf(definition, b); return ka < kb ? -1 : ka > kb ? 1 : 0; });
    return { name: definition.name, columns: [...definition.columns], rows };
  });
}

function makeManifest(tables, definitions = TABLES, format = MANIFEST_FORMAT) {
  const entries = tables.map((value, index) => {
    const rows = value.rows.map(row => ({ key: keyOf(definitions[index], row), sha256: sha256(json(row)) }));
    return { name: value.name, count: rows.length, sha256: sha256(json({ columns: value.columns, rows })), rows };
  });
  return { format, tables: entries, sha256: sha256(json(entries)) };
}

function uniqueRows(tables) {
  const definitions = [
    ['users', ['email']],
    ['tasks', ['template_id', 'due_date']],
    ['notification_deliveries', ['delivery_key']],
    ['rooms', ['name']],
    ['rooms', ['resident_id']],
    ['monthly_bills', ['month', 'user_id']],
  ];
  for (const [name, columns] of definitions) {
    const value = tables.find(table => table.name === name), seen = new Set();
    if (!value) continue;
    for (const row of value.rows) {
      const parts = columns.map(column => {
        const cell = row[value.columns.indexOf(column)];
        // SQLite's NOCASE collation folds ASCII, matching the rooms schema.
        return name === 'rooms' && column === 'name' ? cell.replace(/[A-Z]/g, letter => letter.toLowerCase()) : cell;
      });
      if (parts.some(value => value === null)) continue;
      const key = json(parts);
      if (seen.has(key)) fail(`Restrição UNIQUE duplicada em ${name} (${columns.join(', ')}).`);
      seen.add(key);
    }
  }
}

function validateJsonFields(tables) {
  const entries = name => {
    const value = tables.find(table => table.name === name);
    return value ? value.rows.map(row => Object.fromEntries(value.columns.map((column, index) => [column, row[index]]))) : [];
  };
  const parsed = (value, label, check) => {
    let result;
    try { result = JSON.parse(value); } catch { fail(`JSON inválido em ${label}.`); }
    if (!check(result)) fail(`Estrutura JSON inválida em ${label}.`);
    return result;
  };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  for (const row of entries('settings')) parsed(row.value, 'settings.value', object);
  for (const row of entries('templates')) parsed(row.weekdays, 'templates.weekdays', value => Array.isArray(value) && value.length > 0 && value.every(day => Number.isInteger(day) && day >= 0 && day <= 6));
  for (const row of entries('weekly_draw_plans')) parsed(row.data, 'weekly_draw_plans.data', Array.isArray);
  for (const row of entries('calendar_archives')) parsed(row.data, 'calendar_archives.data', value => object(value) && Array.isArray(value.tasks) && Array.isArray(value.swaps));
  for (const row of entries('notification_subscriptions')) parsed(row.subscription, 'notification_subscriptions.subscription', object);
  for (const row of entries('monthly_bills')) parsed(row.expenses, 'monthly_bills.expenses', value => Array.isArray(value) && value.every(expense => object(expense) && typeof expense.description === 'string' && Number.isSafeInteger(expense.amount_cents) && expense.amount_cents >= 0));
  for (const row of entries('notification_meta').filter(row => row.key === 'vapid')) {
    const keys = parsed(row.value, 'notification_meta.vapid', object);
    try {
      if (typeof keys.publicKey !== 'string' || typeof keys.privateKey !== 'string' || !/^[A-Za-z0-9_-]+$/.test(keys.publicKey) || !/^[A-Za-z0-9_-]+$/.test(keys.privateKey)) throw new Error();
      const publicKey = Buffer.from(keys.publicKey, 'base64url'), privateKey = Buffer.from(keys.privateKey, 'base64url');
      if (publicKey.length !== 65 || publicKey[0] !== 4 || privateKey.length !== 32) throw new Error();
      const pair = createECDH('prime256v1'); pair.setPrivateKey(privateKey);
      if (!pair.getPublicKey().equals(publicKey)) throw new Error();
    } catch { fail('Chaves VAPID inválidas no backup. Nenhuma chave foi substituída.'); }
  }
}

function validateTables(tables, definitions = TABLES) {
  if (!Array.isArray(tables) || tables.length !== definitions.length) fail(`O arquivo precisa conter exatamente as ${definitions.length} tabelas da casa.`);
  const names = tables.map(value => value?.name);
  if (new Set(names).size !== definitions.length || definitions.some(definition => !names.includes(definition.name))) fail('Há tabelas ausentes, repetidas ou desconhecidas no arquivo.');
  for (const definition of definitions) {
    const value = tables.find(value => value.name === definition.name);
    if (!exactKeys(value, ['name', 'columns', 'rows']) || !same(value.columns, definition.columns) || !Array.isArray(value.rows)) fail(`Estrutura ou colunas inválidas em ${definition.name}.`);
    const seen = new Set();
    for (const row of value.rows) {
      if (!Array.isArray(row) || row.length !== definition.columns.length) fail(`Quantidade de colunas inválida em ${definition.name}.`);
      row.forEach((cell, i) => validateValue(cell, definition.fields[i], definition.name));
      const rowBytes = row.reduce((total, cell, index) => total + (cell === null ? 0 : definition.fields[index].type === 'blob' ? Buffer.from(cell.$blob, 'base64').length : typeof cell === 'string' ? Buffer.byteLength(cell, 'utf8') : 8), 16 * definition.fields.length);
      if (rowBytes > MAX_ROW_BYTES) fail(`Uma linha de ${definition.name} excede 2 MB. A migração foi interrompida sem truncar dados.`);
      const key = keyOf(definition, row);
      if (seen.has(key)) fail(`Chave primária repetida em ${definition.name}.`);
      seen.add(key);
    }
  }
  for (const definition of definitions) {
    const value = tables.find(value => value.name === definition.name);
    for (const fk of definition.foreignKeys) {
      const parent = tables.find(value => value.name === fk.table);
      const parentKeys = new Set(parent.rows.map(row => json(row[parent.columns.indexOf(fk.target)])));
      for (const row of value.rows) {
        const id = row[value.columns.indexOf(fk.column)];
        if (id !== null && !parentKeys.has(json(id))) fail(`Referência órfã em ${definition.name}.${fk.column} para ${fk.table}.${fk.target}.`);
      }
    }
  }
  if (tables.find(table => table.name === 'settings').rows.some(row => row[0] !== 1)) fail('A configuração deve utilizar id=1.');
  uniqueRows(tables);
  validateJsonFields(tables);
}

export function validateSnapshot(snapshot) {
  if (!exactKeys(snapshot, ['format', 'createdAt', 'tables', 'manifest']) || ![SNAPSHOT_FORMAT, LEGACY_SNAPSHOT_FORMAT].includes(snapshot.format) || typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt))) fail('Formato ou versão de backup não reconhecido.');
  if (bytes(snapshot) > MAX_SNAPSHOT_BYTES) fail('O backup excede 8 MiB. Planeje uma transferência em partes; nenhum dado foi truncado.');
  const legacy = snapshot.format === LEGACY_SNAPSHOT_FORMAT;
  const definitions = legacy ? LEGACY_TABLES : TABLES, format = legacy ? LEGACY_MANIFEST_FORMAT : MANIFEST_FORMAT;
  validateTables(snapshot.tables, definitions);
  const tables = canonicalTables(snapshot.tables, definitions), manifest = makeManifest(tables, definitions, format);
  // Ignore JSON object key order while requiring the complete canonical manifest.
  if (!snapshot.manifest || snapshot.manifest.format !== format || snapshot.manifest.sha256 !== manifest.sha256 || !same(snapshot.manifest.tables, manifest.tables) || !exactKeys(snapshot.manifest, ['format', 'tables', 'sha256'])) fail('A verificação SHA-256 do backup falhou. O arquivo está incompleto ou foi alterado.');
  return { manifest, counts: Object.fromEntries(manifest.tables.map(value => [value.name, value.count])) };
}

export function exportSnapshot(db, { createdAt = new Date().toISOString() } = {}) {
  const catalog = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  const unknown = catalog.filter(name => !TABLES.some(table => table.name === name) && !name.startsWith('sqlite_') && !name.startsWith('_cf_') && !['_casa_rate_limits', '_casa_schema_migrations', '__miniflare_do_name'].includes(name));
  if (unknown.length) fail('Existem tabelas não reconhecidas: ' + unknown.join(', ') + '. A transferência foi interrompida sem descartar dados; inclua essas tabelas no plano de migração.');
  for (const definition of TABLES) {
    if (!catalog.includes(definition.name)) fail('Tabela ausente no banco: ' + definition.name + '. Prepare a atualização somente sobre uma cópia antes de exportar.');
    const columns = db.prepare(`PRAGMA table_info(${quoted(definition.name)})`).all().map(column => column.name).sort();
    if (!same(columns, [...definition.columns].sort())) fail('Colunas diferentes do esquema esperado em ' + definition.name + '. Nenhuma coluna será descartada.');
  }
  const tables = TABLES.map(definition => {
    const source = db.prepare(`SELECT ${definition.columns.map(quoted).join(',')} FROM ${quoted(definition.name)}`).all();
    const rows = source.map(row => definition.fields.map(field => encodeValue(row[field.name], field, definition.name)));
    return { name: definition.name, columns: [...definition.columns], rows };
  });
  validateTables(tables);
  const sorted = canonicalTables(tables);
  const snapshot = { format: SNAPSHOT_FORMAT, createdAt, tables: sorted, manifest: makeManifest(sorted) };
  validateSnapshot(snapshot);
  return snapshot;
}

export function getManifest(db) { return exportSnapshot(db).manifest; }

function validManifest(value) {
  const definitions = value?.format === MANIFEST_FORMAT ? TABLES : value?.format === LEGACY_MANIFEST_FORMAT ? LEGACY_TABLES : null;
  if (!definitions || !exactKeys(value, ['format', 'tables', 'sha256']) || !Array.isArray(value.tables) || value.tables.length !== definitions.length) return false;
  if (sha256(json(value.tables)) !== value.sha256) return false;
  return definitions.every((definition, index) => {
    const entry = value.tables[index];
    return exactKeys(entry, ['name', 'count', 'sha256', 'rows']) && entry.name === definition.name && Array.isArray(entry.rows) && entry.count === entry.rows.length && entry.rows.every(row => exactKeys(row, ['key', 'sha256']) && typeof row.key === 'string' && /^[a-f0-9]{64}$/.test(row.sha256)) && entry.sha256 === sha256(json({ columns: definition.columns, rows: entry.rows }));
  });
}

export function compareManifests(left, right) {
  const differences = [];
  if (!validManifest(left) || !validManifest(right)) differences.push('Formato ou SHA-256 do manifesto inválido.');
  const leftTables = Array.isArray(left?.tables) ? left.tables : [], rightTables = Array.isArray(right?.tables) ? right.tables : [];
  for (const definition of TABLES) {
    const a = leftTables.find(value => value?.name === definition.name), b = rightTables.find(value => value?.name === definition.name);
    // Version 1 predates finances. It is equivalent only to empty new tables.
    if (!LEGACY_TABLES.includes(definition) && (!a || !b)) {
      if ((!a || (a.count === 0 && a.rows?.length === 0)) && (!b || (b.count === 0 && b.rows?.length === 0))) continue;
    }
    if (!a || !b || a.count !== b.count || a.sha256 !== b.sha256 || !same(a.rows, b.rows)) differences.push(`Contagem ou SHA-256 divergente em ${definition.name}.`);
  }
  if (left?.format === right?.format && left?.sha256 !== right?.sha256 && !differences.length) differences.push('SHA-256 global divergente.');
  return { equal: differences.length === 0, differences };
}

export function importSnapshot(db, snapshot, { transaction } = {}) {
  const { manifest } = validateSnapshot(snapshot);
  if (typeof transaction !== 'function') fail('Uma transação atômica é obrigatória para restaurar o backup.');
  return transaction(() => {
    for (const definition of TABLES) {
      const count = Number(db.prepare(`SELECT count(*) AS n FROM ${quoted(definition.name)}`).get().n);
      if (!count) continue;
      if (definition.name === 'notification_meta' && count === 1 && db.prepare("SELECT key FROM notification_meta WHERE key='vapid'").get()) continue;
      fail(`O destino contém registros em ${definition.name}. A restauração aceita somente uma casa vazia.`, 409);
    }
    // A brand-new target may have generated VAPID; replace it with the source keys.
    db.prepare("DELETE FROM notification_meta WHERE key='vapid'").run();
    for (const definition of TABLES) {
      const source = snapshot.tables.find(value => value.name === definition.name);
      if (!source) continue; // A validated v1 snapshot leaves the three new tables empty.
      const statement = db.prepare(`INSERT INTO ${quoted(definition.name)} (${definition.columns.map(quoted).join(',')}) VALUES (${definition.columns.map(() => '?').join(',')})`);
      for (const row of source.rows) statement.run(...row.map((value, index) => definition.fields[index].type === 'blob' && value !== null ? Buffer.from(value.$blob, 'base64') : value));
    }
    const restored = getManifest(db), comparison = compareManifests(manifest, restored);
    if (!comparison.equal) fail('A conferência após restaurar falhou. A transação foi revertida. ' + comparison.differences.join(' '));
    return restored;
  });
}
