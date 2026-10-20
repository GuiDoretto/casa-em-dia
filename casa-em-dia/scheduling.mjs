import { randomInt } from 'node:crypto';
import { offReason } from './rules.mjs';

export const ALL_WEEKDAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
export function templateWeekdays(template) {
    const value = typeof template.weekdays === 'string' ? JSON.parse(template.weekdays) : template.weekdays;
    return Array.isArray(value) ? value : [...ALL_WEEKDAYS];
}
export function addDays(date, amount) {
    const cursor = new Date(date + 'T12:00:00Z'); cursor.setUTCDate(cursor.getUTCDate() + amount); return cursor.toISOString().slice(0, 10);
}
export function startOfWeek(date) {
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay(); return addDays(date, -((weekday + 6) % 7));
}
export function requestedDates(date, { month = false, week = false } = {}) {
    const end = week ? addDays(startOfWeek(date), 6) : month ? new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0, 12)).toISOString().slice(0, 10) : date;
    const dates = []; for (let day = date; day <= end; day = addDays(day, 1))dates.push(day); return dates;
}
export function templateEligible(template, date) {
    return template.active !== 0 && template.active !== false && templateWeekdays(template).includes(new Date(date + 'T12:00:00Z').getUTCDay());
}
const slotKey = slot => slot.date + '|' + slot.templateId;

// A week is planned independently of the requested day/month. Existing tasks are
// never changed, and future reservations survive repeated draws and restarts.
export function planWeeklySlots({ week, today, count, templates, tasks, slots = [], settings, random = randomInt }) {
    const start = startOfWeek(week), end = addDays(start, 6);
    const existing = tasks.filter(task => task.due_date >= start && task.due_date <= end);
    const counted = existing;
    const budget = Math.max(0, count - counted.length);
    const days = []; for (let day = start; day <= end; day = addDays(day, 1))if (day >= today && !offReason(day, settings)) days.push(day);
    const daySet = new Set(days), byTemplate = new Map(templates.map(template => [template.id, template]));
    const used = new Set(existing.filter(task => task.template_id).map(task => task.due_date + '|' + task.template_id));
    const dailyLoad = new Map(days.map(day => [day, counted.filter(task => task.due_date === day).length]));
    const templateLoad = new Map(templates.map(template => [template.id, counted.filter(task => task.template_id === template.id).length]));
    const planned = [];
    function reserve(slot) {
        const template = byTemplate.get(slot.templateId), key = slotKey(slot);
        if (planned.length >= budget || !daySet.has(slot.date) || !template || !templateEligible(template, slot.date) || used.has(key)) return false;
        planned.push({ date: slot.date, templateId: slot.templateId }); used.add(key);
        dailyLoad.set(slot.date, dailyLoad.get(slot.date) + 1); templateLoad.set(slot.templateId, templateLoad.get(slot.templateId) + 1); return true;
    }
    for (const slot of slots) reserve(slot);
    while (planned.length < budget) {
        const options = days.map(date => ({ date, templates: templates.filter(template => templateEligible(template, date) && !used.has(date + '|' + template.id)) })).filter(option => option.templates.length);
        if (!options.length) break;
        const lightest = Math.min(...options.map(option => dailyLoad.get(option.date)));
        const eligibleDays = options.filter(option => dailyLoad.get(option.date) === lightest);
        const chosenDay = eligibleDays[random(eligibleDays.length)];
        const lightestTemplate = Math.min(...chosenDay.templates.map(template => templateLoad.get(template.id)));
        const eligibleTemplates = chosenDay.templates.filter(template => templateLoad.get(template.id) === lightestTemplate);
        const chosenTemplate = eligibleTemplates[random(eligibleTemplates.length)];
        reserve({ date: chosenDay.date, templateId: chosenTemplate.id });
    }
    return planned.sort((a, b) => a.date.localeCompare(b.date) || a.templateId.localeCompare(b.templateId));
}