import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHouseApplication } from '../application.mjs';
import { parseMoney, calculateBills, billMessage } from '../finances.mjs';

test('valores em reais aceitam vírgula/ponto e rejeitam precisão ou limites indevidos', () => {
  assert.equal(parseMoney('1234,56'), 123456);
  assert.equal(parseMoney('0.01'), 1);
  assert.equal(parseMoney('10'), 1000);
  for (const value of ['-10', '1.005', '1e3', '', null, true, '1.000,00', '10000000']) assert.throws(() => parseMoney(value));
});

test('rateio fecha todos os centavos e soma aluguéis diferentes sem cobrar quarto vazio', () => {
  const bills = calculateBills([
    { resident_id: 'b', name: 'Suíte', rent_cents: 80000 },
    { resident_id: 'a', name: 'Quarto 1', rent_cents: 50000 },
    { resident_id: 'c', name: 'Quarto 2', rent_cents: 60000 },
    { resident_id: null, name: 'Quarto vazio', rent_cents: 90000 },
  ], [{ amount_cents: 10000 }]);
  assert.deepEqual(bills.map(bill => bill.shared_cents), [3334, 3333, 3333]);
  assert.deepEqual(bills.map(bill => bill.total_cents), [53334, 83333, 63333]);
  assert.equal(bills.reduce((total, bill) => total + bill.shared_cents, 0), 10000);
  assert.deepEqual(calculateBills([], [{ amount_cents: 10000 }]), []);
});

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const app = createHouseApplication({ db, env: {}, setupToken: 'test' });
  t.after(async () => { await app.notifications.stop(); db.close(); });
  async function call(path, data, cookie = '') {
    let session = '';
    const req = {
      method: data === undefined ? 'GET' : 'POST', url: '/api/' + path,
      headers: { origin: 'https://casa.example.test', host: 'casa.example.test', cookie, 'x-setup-token': 'test' },
      socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { if (data !== undefined) yield JSON.stringify(data); },
    };
    const state = await app.api(req, { setHeader(name, value) { if (name === 'Set-Cookie') session = value.split(';')[0]; } }, '/api/' + path);
    return { state, cookie: session || cookie };
  }
  const admin = await call('setup', { houseName: 'Casa teste', name: 'Admin', email: 'admin@example.test', password: 'Senha de teste segura' });
  const created = await call('save-user', { name: 'Beatriz', email: 'bia@example.test', phone: '(11) 99999-9999' }, admin.cookie);
  const member = await call('accept-invite', { token: created.state.inviteToken, password: 'Senha moradora segura' });
  return { db, call, admin, member };
}

test('quartos e despesas persistem, cobrança é privada e snapshot resiste a edições futuras', async t => {
  const { db, call, admin, member } = await fixture(t);
  const save = (path, data) => call(path, data, admin.cookie);
  await save('room-save', { name: 'Quarto 1', rent: '500,00', features: 'Janela para o jardim', resident_id: member.state.user.id });
  await save('room-save', { name: 'Suíte', rent: '800', features: 'Banheiro próprio', resident_id: admin.state.user.id });
  await save('room-save', { name: 'Quarto vazio', rent: '600', features: '', resident_id: '' });
  await save('expense-save', { month: '2026-10', description: 'Energia', amount: '100,01' });
  const generated = (await save('bills-generate', { month: '2026-10' })).state;
  assert.equal(generated.bills.length, 2);
  assert.equal(generated.bills.reduce((sum, bill) => sum + bill.shared_cents, 0), 10001);
  const ownState = (await call('state', undefined, member.cookie)).state;
  assert.equal(ownState.bills.length, 1);
  assert.equal(ownState.bills[0].user_id, member.state.user.id);
  assert.deepEqual(ownState.expenses, []);
  assert.equal(ownState.users.find(user => user.id === admin.state.user.id).email, undefined);
  assert.match(billMessage(ownState.bills[0], 'Casa teste'), /Aluguel: R\$\s500,00/);
  const room = generated.rooms.find(room => room.resident_id === member.state.user.id);
  await save('room-save', { id: room.id, name: room.name, rent: '900', features: 'Mudou', resident_id: member.state.user.id });
  assert.equal((await call('state', undefined, member.cookie)).state.bills[0].rent_cents, 50000);
  await save('bills-generate', { month: '2026-11' });
  const second = (await call('state', undefined, member.cookie)).state;
  assert.equal(second.bills.find(bill => bill.month === '2026-11').rent_cents, 90000);
  assert.equal(second.bills.find(bill => bill.month === '2026-10').rent_cents, 50000);
  await save('bills-generate', { month: '2026-10' });
  assert.equal(db.prepare("SELECT count(*) AS n FROM monthly_bills WHERE month='2026-10'").get().n, 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('API restringe administração, valida entradas e evita dupla ocupação ou exclusão ocupada', async t => {
  const { call, admin, member } = await fixture(t);
  const save = (path, data) => call(path, data, admin.cookie);
  for (const path of ['room-save', 'room-delete', 'expense-save', 'expense-delete', 'bills-generate']) await assert.rejects(call(path, {}, member.cookie), { status: 403 });
  await assert.rejects(call('room-save', {}), { status: 401 });
  await assert.rejects(save('bills-generate', { month: '2026-10' }), /Atribua ao menos/);
  await assert.rejects(save('expense-save', { month: '2026-13', description: 'Conta', amount: '10' }), /mês válido/);
  await assert.rejects(save('expense-save', { month: '2026-10', description: 'Conta', amount: '0' }), /maior que zero/);
  await assert.rejects(save('expense-save', { month: '2026-10', description: 'Conta', amount: '1,001' }), /duas casas/);
  const result = await save('room-save', { name: 'Quarto', rent: '450', features: '', resident_id: member.state.user.id });
  const room = result.state.rooms[0];
  await assert.rejects(save('room-save', { name: 'Outro', rent: '450', features: '', resident_id: member.state.user.id }), { status: 409 });
  await assert.rejects(save('room-save', { name: 'quarto', rent: '450', features: '', resident_id: '' }), { status: 409 });
  await assert.rejects(save('room-save', { name: 'Terceiro', rent: '450', features: '', resident_id: 'inexistente' }), /não está ativo/);
  await assert.rejects(save('room-delete', { id: room.id }), { status: 409 });
  await save('save-user', { id: member.state.user.id, name: 'Beatriz', email: 'bia@example.test', active: false });
  const state = (await call('state', undefined, admin.cookie)).state;
  assert.equal(state.rooms[0].resident_id, null);
  await save('room-delete', { id: room.id });
});

test('falha no meio da geração reverte todas as cobranças do mês', async t => {
  const { db, call, admin, member } = await fixture(t);
  const save = (path, data) => call(path, data, admin.cookie);
  await save('room-save', { name: 'A', rent: '500', features: '', resident_id: admin.state.user.id });
  await save('room-save', { name: 'B', rent: '700', features: '', resident_id: member.state.user.id });
  await save('bills-generate', { month: '2026-10' });
  const before = db.prepare('SELECT * FROM monthly_bills ORDER BY id').all();
  db.exec(`CREATE TRIGGER fail_bill BEFORE INSERT ON monthly_bills WHEN NEW.room_name='B' BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`);
  await assert.rejects(save('bills-generate', { month: '2026-10' }), /falha simulada/);
  assert.deepEqual(db.prepare('SELECT * FROM monthly_bills ORDER BY id').all(), before);
});
