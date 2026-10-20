export function localNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s; }
export function nationalHolidays(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(Date.UTC(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  const friday = new Date(easter); friday.setUTCDate(friday.getUTCDate() - 2);
  const days = { '01-01': 'Confraternização Universal', '04-21': 'Tiradentes', '05-01': 'Dia do Trabalho', '09-07': 'Independência do Brasil', '10-12': 'Nossa Senhora Aparecida', '11-02': 'Finados', '11-15': 'Proclamação da República', '11-20': 'Consciência Negra', '12-25': 'Natal' };
  return { ...Object.fromEntries(Object.entries(days).map(([date, name]) => [`${year}-${date}`, name])), [friday.toISOString().slice(0, 10)]: 'Sexta-feira Santa' };
}
export const defaultSettings = { houseName: 'Nossa casa', disabledDays: [0, 6], skipHolidays: true, holidays: {}, reminderMinutes: 30, paused: false, autoGenerate: true, drawPeriod: 'all', drawCount: 3 };
export function offReason(date, settings) {
  if (settings.paused) return 'Limpeza pausada';
  if (settings.disabledDays.includes(new Date(date + 'T12:00:00Z').getUTCDay())) return 'Dia de folga';
  if (settings.skipHolidays) return settings.holidays[date] || nationalHolidays(Number(date.slice(0, 4)))[date] || null;
  return null;
}
export function isDue(task, now = localNow()) { return task.due_date < now.date || (task.due_date === now.date && task.deadline < now.time); }
export function award(task, now = localNow()) { return isDue(task, now) ? 0 : 10; }
export function swappable(task, now = localNow()) { return task && task.status === 'pending' && !isDue(task, now); }
