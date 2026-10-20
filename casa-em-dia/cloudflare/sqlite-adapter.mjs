import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

function binding(value) {
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  if (value === undefined) throw new TypeError('Parâmetro SQL ausente.');
  return value;
}

function rows(cursor) {
  return cursor.toArray().map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof ArrayBuffer ? Buffer.from(value) : value])));
}

// This adapter retains SQLite's synchronous transaction semantics inside one DO.
// node:sqlite stays exclusively in the local Node entrypoint and migration CLI.
export function createDurableSqliteDatabase(storage) {
  const execute = (query, values = []) => storage.sql.exec(query, ...values.map(binding));
  return {
    exec(query) { rows(execute(query)); },
    prepare(query) {
      return {
        get(...values) { return rows(execute(query, values))[0]; },
        all(...values) { return rows(execute(query, values)); },
        run(...values) {
          rows(execute(query, values));
          return rows(execute('SELECT changes() AS changes,last_insert_rowid() AS lastInsertRowid'))[0];
        },
      };
    },
    transaction(callback) {
      return storage.transactionSync(() => {
        const result = callback();
        if (result && typeof result.then === 'function') throw new TypeError('A transação SQLite deve ser síncrona.');
        return result;
      });
    },
  };
}

export function createPersistentRateLimiter(db) {
  db.exec('CREATE TABLE IF NOT EXISTS _casa_rate_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS _casa_rate_expiry ON _casa_rate_limits(expires)');
  return (request, label, maximum) => {
    const now = Date.now();
    const key = createHash('sha256').update(`${request.socket.remoteAddress}:${label}`).digest('hex');
    const count = db.transaction(() => {
      db.prepare('DELETE FROM _casa_rate_limits WHERE expires<?').run(now);
      db.prepare('INSERT INTO _casa_rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + 900000);
      return db.prepare('SELECT count FROM _casa_rate_limits WHERE key=?').get(key).count;
    });
    if (count > maximum) throw Object.assign(new Error('Muitas tentativas. Aguarde 15 minutos.'), { status: 429 });
  };
}
