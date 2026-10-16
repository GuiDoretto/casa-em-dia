'use client';
const DAYS = [
  [1, 'Seg', 'Segunda-feira'], [2, 'Ter', 'Terça-feira'], [3, 'Qua', 'Quarta-feira'],
  [4, 'Qui', 'Quinta-feira'], [5, 'Sex', 'Sexta-feira'], [6, 'Sáb', 'Sábado'], [0, 'Dom', 'Domingo'],
];
export function weekdaySummary(weekdays) {
  if (!Array.isArray(weekdays) || weekdays.length === 7) return 'Todos os dias habilitados';
  return DAYS.filter(([id]) => weekdays.includes(id)).map(([, short]) => short).join(' · ') || 'Sem dias definidos';
}
export default function ActivityWeekdays({ value, onChange }) {
  return <fieldset className="activity-weekdays"><legend>Dias desta atividade</legend>
    <p className="hint">Marque quando essa atividade pode entrar no sorteio. As folgas da casa continuam valendo.</p>
    <div className="activity-weekday-options">{DAYS.map(([id, short, label]) =>
      <label key={id} className="activity-weekday-option"><input type="checkbox" aria-label={label} checked={value.includes(id)} onChange={event => onChange(event.target.checked ? [...value, id].sort((a, b) => a - b) : value.filter(day => day !== id))}/><span>{short}</span></label>
    )}</div>
  </fieldset>;
}
