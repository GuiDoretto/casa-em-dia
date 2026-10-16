import { localNow, offReason, isDue, swappable } from '../rules.mjs';
export { localNow, offReason, isDue, swappable };
export const addDay = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const formatDate = (day, options = { day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...options }).format(new Date(day + 'T12:00:00Z'));
export const monthLabel = (month) => formatDate(month + '-01', { month: 'long', year: 'numeric' });
export const changeMonth = (month, delta) => { const d = new Date(month + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + delta); return d.toISOString().slice(0, 7); };
export const monday = (date) => addDay(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7));
export const userFor = (state, id) => state.users.find(u => u.id === id) || { id, name: 'Morador' };
export const scores = (state, month) => state.users.map(u => {
  const done = state.tasks.filter(t => t.assignee_id === u.id && t.due_date.startsWith(month) && t.status === 'done');
  return { ...u, points: done.reduce((sum, t) => sum + t.points, 0), done: done.length };
}).sort((a, b) => b.points - a.points || b.done - a.done || a.name.localeCompare(b.name));
export async function api(path, data, extraHeaders = {}, signal) {
  const response = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('O servidor não respondeu como esperado. Tente novamente.'); }
  if (!response.ok) throw Object.assign(new Error(result.error || 'Não foi possível realizar a ação.'), { status: response.status });
  return result;
}
export async function exportData() {
  const data = await api('export');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'casa-em-dia-' + localNow().date + '.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
