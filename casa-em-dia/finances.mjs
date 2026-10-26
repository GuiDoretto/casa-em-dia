// Shared by the API and browser. All calculations use integer centavos.
export const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export function parseMoney(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Informe um valor válido em reais.');
  const input = String(value).trim();
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(input)) throw new Error('Informe um valor de até R$ 9.999.999,99, com no máximo duas casas decimais.');
  const [whole, fraction = ''] = input.replace(',', '.').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function calculateBills(rooms, expenses) {
  const occupied = rooms.filter(room => room.resident_id).slice().sort((a, b) => a.resident_id.localeCompare(b.resident_id));
  const total = expenses.reduce((sum, expense) => sum + expense.amount_cents, 0);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('O total das despesas está fora do limite permitido.');
  const count = occupied.length, share = count ? Math.floor(total / count) : 0, remainder = count ? total % count : 0;
  return occupied.map((room, index) => {
    const shared = share + (index < remainder ? 1 : 0), totalCents = room.rent_cents + shared;
    if (!Number.isSafeInteger(totalCents)) throw new Error('O total da cobrança está fora do limite permitido.');
    return { user_id: room.resident_id, resident_name: room.resident_name, room_name: room.name, rent_cents: room.rent_cents, shared_cents: shared, total_cents: totalCents };
  });
}
export function billMessage(bill, houseName = 'Casa em Dia') {
  const [year, month] = bill.month.split('-');
  return [
    `${houseName} · Despesas de ${month}/${year}`,
    `Olá, ${bill.resident_name}!`,
    `Quarto: ${bill.room_name}`,
    `Aluguel: ${money(bill.rent_cents)}`,
    ...(bill.expenses || []).map(expense => `${expense.description} (total da casa): ${money(expense.amount_cents)}`),
    `Sua parte das despesas comuns: ${money(bill.shared_cents)}`,
    `Total a pagar: ${money(bill.total_cents)}`,
    'As despesas comuns foram divididas igualmente entre os moradores com quarto atribuído; os centavos restantes foram distribuídos para fechar o total.',
  ].join('\n');
}
