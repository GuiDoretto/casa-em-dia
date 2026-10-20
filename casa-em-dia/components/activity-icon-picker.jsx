'use client';
import { useState } from 'react';
import { ACTIVITY_ICONS, resolveActivityIcon } from '../activity-icons.mjs';
import { Icon } from './ui';

export default function ActivityIconPicker({ activity }) {
  const [selected, setSelected] = useState(() => resolveActivityIcon(activity));
  const option = ACTIVITY_ICONS.find(icon => icon.id === selected);
  return <fieldset className="activity-icon-picker">
    <legend>Ícone da atividade</legend>
    <p className="hint">Escolha o símbolo que combina com esse cuidado.</p>
    <div className="activity-icon-options">{ACTIVITY_ICONS.map(icon =>
      <label className="activity-icon-option" key={icon.id}>
        <input className="sr-only" type="radio" name="icon" value={icon.id} checked={selected === icon.id} onChange={() => setSelected(icon.id)} />
        <span className="activity-icon-tile"><Icon name={icon.id} size={24} /><span>{icon.label}</span></span>
      </label>
    )}</div>
    <p className="activity-icon-preview" aria-live="polite"><Icon name={selected} size={18} /><span>Ícone escolhido: <strong>{option.label}</strong></span></p>
  </fieldset>;
}
