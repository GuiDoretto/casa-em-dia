import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../rules.mjs';
import { ALL_WEEKDAYS, addDays, startOfWeek, requestedDates, templateWeekdays, templateEligible, planWeeklySlots } from '../scheduling.mjs';

const monday = '2026-10-19';
const settings = { ...defaultSettings, disabledDays: [], skipHolidays: false, autoGenerate: false };
const template = (id, weekdays = [...ALL_WEEKDAYS], active = 1) => ({ id, weekdays, active });
const templates = ['kitchen', 'trash', 'garage', 'dishes'].map(id => template(id));
const key = slot => slot.date + '|' + slot.templateId;
function plan(overrides = {}) {
  return planWeeklySlots({ week: monday, today: monday, count: 3, templates, tasks: [], slots: [], settings, random: () => 0, ...overrides });
}
function scheduled(slot, status = 'pending') {
  return { due_date: slot.date, template_id: slot.templateId, status };
}
function assertValidSlots(slots, eligibleTemplates, firstDay, lastDay) {
  assert.equal(new Set(slots.map(key)).size, slots.length, 'não repete uma atividade na mesma data');
  for (const slot of slots) {
    assert.ok(slot.date >= firstDay && slot.date <= lastDay, 'a data pertence ao intervalo permitido');
    assert.ok(templateEligible(eligibleTemplates.find(item => item.id === slot.templateId), slot.date), 'respeita os dias da atividade');
  }
}

test('semana é de segunda a domingo e atravessa mês e ano sem reiniciar o período', () => {
  assert.equal(startOfWeek('2026-11-01'), '2026-10-26');
  assert.equal(startOfWeek('2027-01-01'), '2026-12-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.deepEqual(requestedDates('2026-10-30', { week: true }), ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(requestedDates('2026-10-30', { month: true }), ['2026-10-30', '2026-10-31']);
  assert.deepEqual(requestedDates('2027-01-01', { week: true }), ['2027-01-01', '2027-01-02', '2027-01-03']);
  assert.deepEqual(requestedDates('2026-12-31', { month: true }), ['2026-12-31']);
  assert.deepEqual(requestedDates(monday), [monday]);
  const crossing = plan({ week: '2026-10-30', today: '2026-10-30' });
  assert.deepEqual(crossing.map(slot => slot.date), ['2026-10-30', '2026-10-31', '2026-11-01']);
  const existing = [
    { due_date: '2026-10-26', status: 'done' },
    { due_date: '2026-10-31', status: 'pending' },
    { due_date: '2026-11-01', status: 'paused' },
  ];
  assert.deepEqual(plan({ week: '2026-11-01', today: '2026-10-30', tasks: existing }), []);
});

test('três atividades semanais ficam em três dias quando existe capacidade', () => {
  const slots = plan();
  assert.equal(slots.length, 3);
  assert.equal(new Set(slots.map(slot => slot.date)).size, 3);
  assertValidSlots(slots, templates, monday, addDays(monday, 6));
  assert.equal(slots.filter(slot => slot.date === monday).length, 1, 'não concentra a quota inteira na segunda');
});

test('reservas persistidas permanecem iguais ao repetir o sorteio, mesmo com outra aleatoriedade', () => {
  const original = plan();
  const persisted = JSON.parse(JSON.stringify(original));
  assert.deepEqual(plan({ slots: persisted, random: size => size - 1 }), original);
  assert.deepEqual(plan({ slots: original }), original);
});

test('materializar um dia conserva as outras reservas e não abre outra quota', () => {
  const original = plan();
  for (const selected of [original[0], original[2]]) {
    const tasks = [scheduled(selected)];
    const remaining = plan({ tasks, slots: original, random: size => size - 1 });
    assert.deepEqual(remaining, original.filter(slot => key(slot) !== key(selected)));
    assert.equal(tasks.length + remaining.length, 3);
    assert.ok(remaining.every(slot => key(slot) !== key(selected)));
  }
});

test('dias definidos permitem cozinha e lixo segunda, garagem terça', () => {
  const exact = [template('kitchen', [1]), template('trash', [1]), template('garage', [2])];
  const slots = plan({ templates: exact });
  assert.equal(slots.length, 3);
  assert.equal(slots.filter(slot => slot.date === monday).length, 2);
  assert.equal(slots.filter(slot => slot.date === addDays(monday, 1)).length, 1);
  assertValidSlots(slots, exact, monday, addDays(monday, 1));
  assert.equal(slots.find(slot => slot.templateId === 'garage').date, addDays(monday, 1));
});

test('limite conta tarefas manuais, concluídas e pausadas para não estourar ao reativar', () => {
  const tasks = [
    { due_date: monday, template_id: 'kitchen', status: 'paused' },
    { due_date: addDays(monday, 1), template_id: null, status: 'done' },
    { due_date: addDays(monday, 2), template_id: null, status: 'pending' },
  ];
  assert.deepEqual(plan({ tasks }), []);
  assert.deepEqual(plan({ tasks, count: 2 }), [], 'reduzir limite não gera substitutas ou remove as existentes');
  const remaining = plan({ tasks, count: 5 });
  assert.equal(remaining.length + tasks.length, 5);
  assert.ok(!remaining.some(slot => slot.date === monday && slot.templateId === 'kitchen'));
  const resumed = tasks.map(task => ({ ...task, status: task.status === 'paused' ? 'pending' : task.status }));
  assert.deepEqual(plan({ tasks: resumed, slots: remaining, count: 5 }), remaining);
});

test('quota semanal ignora tarefas de outras semanas', () => {
  const tasks = [
    { due_date: addDays(monday, -1), status: 'pending' },
    { due_date: addDays(monday, 7), status: 'done' },
  ];
  assert.equal(plan({ tasks }).length, 3);
});

test('capacidade insuficiente gera menos tarefas e não repete template/data', () => {
  const scarce = [template('garage', [2]), template('inactive', [...ALL_WEEKDAYS], 0)];
  const slots = plan({ count: 100, templates: scarce });
  assert.deepEqual(slots, [{ date: addDays(monday, 1), templateId: 'garage' }]);
  assertValidSlots(slots, scarce, monday, addDays(monday, 6));
  assert.deepEqual(plan({ templates: [] }), []);
  assert.deepEqual(plan({ templates: [template('disabled', [1], 0)] }), []);
});

test('folgas, pausa e feriados impedem novas reservas', () => {
  assert.deepEqual(plan({ settings: { ...settings, paused: true } }), []);
  assert.deepEqual(plan({ settings: { ...settings, disabledDays: [...ALL_WEEKDAYS] } }), []);
  const onlyMonday = [template('kitchen', [1])];
  assert.deepEqual(plan({ templates: onlyMonday, settings: { ...settings, skipHolidays: true, holidays: { [monday]: 'Folga da casa' } } }), []);
  const days = plan({ count: 20, templates: [template('daily')], settings: { ...settings, disabledDays: [0, 6] } });
  assert.equal(days.length, 5);
  assert.ok(days.every(slot => ![0, 6].includes(new Date(slot.date + 'T12:00:00Z').getUTCDay())));
});

test('reservas expiradas são recompostas no presente ou futuro sem criar datas passadas', () => {
  const original = plan();
  const today = addDays(monday, 3);
  const future = plan({ today, slots: original });
  assert.equal(future.length, 3);
  assertValidSlots(future, templates, today, addDays(monday, 6));
  assert.deepEqual(plan({ today, slots: future, random: size => size - 1 }), future);
  assert.deepEqual(plan({ today: addDays(monday, 7), slots: original }), []);
});

test('reservas válidas sobrevivem quando outras ficam inválidas ou duplicadas', () => {
  const keep = { date: addDays(monday, 2), templateId: 'garage' };
  const slots = [keep, keep, { date: monday, templateId: 'removed-template' }, { date: addDays(monday, -1), templateId: 'kitchen' }];
  const result = plan({ slots });
  assert.equal(result.length, 3);
  assert.ok(result.some(slot => key(slot) === key(keep)));
  assertValidSlots(result, templates, monday, addDays(monday, 6));
});

test('modelos antigos recebem todos os dias e JSON persistido mantém os dias escolhidos', () => {
  assert.deepEqual(templateWeekdays({}), [...ALL_WEEKDAYS]);
  assert.deepEqual(templateWeekdays({ weekdays: '[1,3,5]' }), [1, 3, 5]);
  assert.equal(templateEligible({ active: 1, weekdays: '[1,3,5]' }, monday), true);
  assert.equal(templateEligible({ active: 1, weekdays: '[1,3,5]' }, addDays(monday, 1)), false);
});
