import { calculateBills, parseMoney } from './finances.mjs';

export function createFinances({ db, uid, fail, requireAdmin, activeUser }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,rent_cents INTEGER NOT NULL CHECK(rent_cents>=0),features TEXT NOT NULL DEFAULT '',resident_id TEXT UNIQUE REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS monthly_expenses (id TEXT PRIMARY KEY,month TEXT NOT NULL,description TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0));
    CREATE TABLE IF NOT EXISTS monthly_bills (id TEXT PRIMARY KEY,month TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),resident_name TEXT NOT NULL,room_name TEXT NOT NULL,rent_cents INTEGER NOT NULL,shared_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,expenses TEXT NOT NULL,generated_at TEXT NOT NULL,UNIQUE(month,user_id));
    CREATE INDEX IF NOT EXISTS monthly_expenses_month ON monthly_expenses(month);
    CREATE INDEX IF NOT EXISTS monthly_bills_user ON monthly_bills(user_id,month);
  `);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const text = (value, label, max) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label}: preencha um valor de até ${max} caracteres.`);
    return value.trim();
  };
  const month = value => {
    if (typeof value !== 'string' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(value)) fail('Escolha um mês válido entre 2000 e 2099.');
    return value;
  };
  const amount = value => { try { return parseMoney(value); } catch (error) { fail(error.message); } };
  const identifier = value => {
    if (typeof value !== 'string' || !value || value.length > 100) fail('Identificador inválido.');
    return value;
  };
  const rooms = () => all('SELECT r.id,r.name,r.rent_cents,r.features,CASE WHEN u.active=1 THEN r.resident_id ELSE NULL END AS resident_id,CASE WHEN u.active=1 THEN u.name ELSE NULL END AS resident_name FROM rooms r LEFT JOIN users u ON u.id=r.resident_id ORDER BY r.name COLLATE NOCASE,r.id');
  function view(user) {
    const bills = user.role === 'admin' ? all('SELECT * FROM monthly_bills ORDER BY month DESC,resident_name') : all('SELECT * FROM monthly_bills WHERE user_id=? ORDER BY month DESC', user.id);
    return { rooms: rooms(), expenses: user.role === 'admin' ? all('SELECT * FROM monthly_expenses ORDER BY month DESC,description,id') : [], bills: bills.map(bill => ({ ...bill, expenses: JSON.parse(bill.expenses) })) };
  }
  function handle(path, b, user) {
    if (!['/api/room-save', '/api/room-delete', '/api/expense-save', '/api/expense-delete', '/api/bills-generate'].includes(path)) return false;
    requireAdmin(user);
    if (b.id !== undefined) identifier(b.id);
    if (b.resident_id !== undefined && b.resident_id !== null && b.resident_id !== '') identifier(b.resident_id);
    if (path === '/api/room-save') {
      const id = b.id || uid(), name = text(b.name, 'Nome do quarto', 70), rent = amount(b.rent);
      if (b.id && !one('SELECT id FROM rooms WHERE id=?', id)) fail('Quarto não encontrado.', 404);
      if (one('SELECT id FROM rooms WHERE name=? COLLATE NOCASE AND id!=?', name, id)) fail('Já existe um quarto com esse nome.', 409);
      if (typeof b.features !== 'string' || b.features.trim().length > 1000) fail('Descreva os diferenciais em até 1000 caracteres.');
      const resident = b.resident_id || null;
      if (resident) {
        activeUser(resident);
        if (one('SELECT id FROM rooms WHERE resident_id=? AND id!=?', resident, id)) fail('Este morador já está em outro quarto. Libere o quarto anterior primeiro.', 409);
      }
      run('INSERT INTO rooms(id,name,rent_cents,features,resident_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,rent_cents=excluded.rent_cents,features=excluded.features,resident_id=excluded.resident_id', id, name, rent, b.features.trim(), resident);
    } else if (path === '/api/room-delete') {
      const room = one('SELECT * FROM rooms WHERE id=?', identifier(b.id));
      if (!room) fail('Quarto não encontrado.', 404);
      if (room.resident_id) fail('Libere o quarto antes de excluí-lo.', 409);
      run('DELETE FROM rooms WHERE id=?', room.id);
    } else if (path === '/api/expense-save') {
      const id = b.id || uid(), selectedMonth = month(b.month), description = text(b.description, 'Descrição da despesa', 120), cents = amount(b.amount);
      if (!cents) fail('A despesa deve ser maior que zero.');
      const existing = b.id ? one('SELECT * FROM monthly_expenses WHERE id=?', id) : null;
      if (b.id && !existing) fail('Despesa não encontrada.', 404);
      if (existing && existing.month !== selectedMonth) fail('Edite a despesa no mês em que foi cadastrada.');
      run('INSERT INTO monthly_expenses(id,month,description,amount_cents) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET description=excluded.description,amount_cents=excluded.amount_cents', id, selectedMonth, description, cents);
    } else if (path === '/api/expense-delete') {
      if (!one('SELECT id FROM monthly_expenses WHERE id=?', identifier(b.id))) fail('Despesa não encontrada.', 404);
      run('DELETE FROM monthly_expenses WHERE id=?', b.id);
    } else {
      const selectedMonth = month(b.month), occupiedRooms = rooms().filter(room => room.resident_id && activeUser(room.resident_id));
      if (!occupiedRooms.length) fail('Atribua ao menos um quarto a um morador antes de gerar as cobranças.');
      const expenses = all('SELECT description,amount_cents FROM monthly_expenses WHERE month=? ORDER BY description,id', selectedMonth), generated = new Date().toISOString();
      const bills = calculateBills(occupiedRooms, expenses);
      // This runs inside the application's transaction: all bills for the month change together.
      run('DELETE FROM monthly_bills WHERE month=?', selectedMonth);
      for (const bill of bills) run('INSERT INTO monthly_bills(id,month,user_id,resident_name,room_name,rent_cents,shared_cents,total_cents,expenses,generated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', uid(), selectedMonth, bill.user_id, bill.resident_name, bill.room_name, bill.rent_cents, bill.shared_cents, bill.total_cents, JSON.stringify(expenses), generated);
    }
    return true;
  }
  return { view, handle };
}
