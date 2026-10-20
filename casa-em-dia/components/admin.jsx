'use client';
import { useState } from 'react';
import { resolveActivityIcon } from '../activity-icons.mjs';
import { weekdaySummary } from './activity-weekdays';
import { useHouse } from '../lib/house-context';
import { exportData, formatDate } from '../lib/client.mjs';
import { Empty, Icon } from './ui';
import { NotificationServerStatus } from './notification-settings';

function CheckSetting({ name, title, description, value, onChange, disabled }) {
  return <label className="check-row"><span><strong>{title}</strong><small>{description}</small></span><input name={name} type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} disabled={disabled}/></label>;
}

function SettingsForm({ settings }) {
  const { state, busy, mutate, notify } = useHouse();
  const [draft, setDraft] = useState(() => ({
    houseName: settings.houseName, disabledDays: [...settings.disabledDays], skipHolidays: settings.skipHolidays,
    autoGenerate: settings.autoGenerate, paused: settings.paused, reminderMinutes: settings.reminderMinutes,
    drawPeriod: settings.drawPeriod || 'all', drawCount: settings.drawCount ?? 3,
  }));
  const [error, setError] = useState('');
  const change = (name, value) => setDraft(current => ({ ...current, [name]: value }));
  async function save(event) {
    event.preventDefault(); setError('');
    try {
      await mutate('settings', { ...state.settings, ...draft, holidays: state.settings.holidays });
      notify('Combinados da casa atualizados.');
    } catch (failure) { setError(failure.message); }
  }
  return <form className="panel admin-section" onSubmit={save}>
    <div className="section-heading"><div><h2>Os combinados da casa</h2><p>Uma rotina que funciona para todo mundo.</p></div><Icon name="settings" size={22}/></div>
    <label className="field"><span>Nome da casa</span><input name="houseName" required maxLength={70} value={draft.houseName} onChange={event => change('houseName', event.target.value)} disabled={busy}/></label>
    <div className="field"><span>Dias de folga</span><p className="hint">Selecione os dias em que ninguém precisa limpar.</p><div className="week-options">
      {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, index) => <button key={day} type="button" className={draft.disabledDays.includes(index) ? 'selected' : ''} aria-label={'Folga: ' + day} aria-pressed={draft.disabledDays.includes(index)} disabled={busy} onClick={() => change('disabledDays', draft.disabledDays.includes(index) ? draft.disabledDays.filter(value => value !== index) : [...draft.disabledDays, index].sort())}>{day}</button>)}
    </div></div>
    <fieldset className="draw-limits"><legend>Quantidade de atividades no sorteio</legend>
      <label className="field"><span>Como limitar as atividades?</span><select name="drawPeriod" value={draft.drawPeriod} disabled={busy} onChange={event => change('drawPeriod', event.target.value)}>
        <option value="all">Todas as atividades dos dias permitidos</option><option value="daily">Limite por dia</option><option value="weekly">Limite por semana</option>
      </select></label>
      {draft.drawPeriod !== 'all' && <label className="field"><span>{draft.drawPeriod === 'weekly' ? 'Máximo de atividades por semana' : 'Máximo de atividades por dia'}</span><input type="number" name="drawCount" min={1} max={100} step={1} required value={draft.drawCount} disabled={busy} onChange={event => change('drawCount', event.target.value === '' ? '' : Number(event.target.value))}/></label>}
      <p className="hint">A semana vai de segunda a domingo. O limite conta as tarefas já agendadas e preserva os combinados existentes. Cada atividade tem seus próprios dias, definidos no lápis ao lado.</p>
      <div className="draw-limit-note"><Icon name="users" size={18}/><p>Nem todo morador precisa receber tarefas toda semana. O sorteio prioriza quem tem menos atividades no mês.</p></div>
    </fieldset>

    <CheckSetting name="skipHolidays" title="Respeitar feriados" description="Feriados nacionais e as datas extras cadastradas ao lado." value={draft.skipHolidays} onChange={value => change('skipHolidays', value)} disabled={busy}/>
    <CheckSetting name="autoGenerate" title="Gerar as tarefas diárias" description="Com o servidor ligado, sorteia o que faltar para hoje a cada minuto." value={draft.autoGenerate} onChange={value => change('autoGenerate', value)} disabled={busy}/>
    <CheckSetting name="paused" title="Pausar a limpeza da casa" description="Pausa as tarefas de hoje e futuras. As concluídas ficam no histórico." value={draft.paused} onChange={value => change('paused', value)} disabled={busy}/>
    <label className="field"><span>Repetir alertas a cada</span><select name="reminderMinutes" value={draft.reminderMinutes} onChange={event => change('reminderMinutes', Number(event.target.value))} disabled={busy}>{[15, 30, 60, 120].map(minutes => <option key={minutes} value={minutes}>{minutes} minutos</option>)}</select><small className="hint">O servidor repete os avisos nos aparelhos ativados, durante o dia e enquanto houver tarefas pendentes.</small></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="btn full" disabled={busy}><Icon name="check" size={16}/>{busy ? 'Salvando…' : 'Salvar configurações'}</button>
  </form>;
}

function Holidays() {
  const { state, busy, mutate, notify } = useHouse();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  async function update(holidays, message) {
    setError('');
    try { await mutate('settings', { ...state.settings, holidays }); notify(message); return true; }
    catch (failure) { setError(failure.message); return false; }
  }
  async function add(event) {
    event.preventDefault();
    if (!date || !reason.trim()) return;
    if (await update({ ...state.settings.holidays, [date]: reason.trim() }, 'Data de folga salva.')) { setDate(''); setReason(''); }
  }
  async function remove(day) {
    const holidays = { ...state.settings.holidays }; delete holidays[day];
    await update(holidays, 'Data de folga removida.');
  }
  return <section className="panel admin-section"><h2>Datas extras de folga</h2><p className="hint">Feriados locais, viagens e outros combinados. Valem com “Respeitar feriados” ativado.</p>
    <div className="holiday-list">{Object.entries(state.settings.holidays).sort(([a], [b]) => a.localeCompare(b)).map(([day, name]) => <div className="holiday-row" key={day}><time dateTime={day}>{formatDate(day, { day: '2-digit', month: 'short', year: 'numeric' })}</time><span>{name}</span><button type="button" className="icon-btn" aria-label={'Remover folga: ' + name} disabled={busy} onClick={() => remove(day)}><Icon name="close" size={15}/></button></div>)}{!Object.keys(state.settings.holidays).length && <p className="hint">Nenhuma data extra por enquanto.</p>}</div>
    <form className="stack holiday-form" onSubmit={add}><div className="form-grid"><label className="field"><span>Dia da folga</span><input name="holidayDate" type="date" required value={date} onChange={event => setDate(event.target.value)} disabled={busy}/></label><label className="field"><span>Motivo</span><input name="holidayReason" required maxLength={70} placeholder="Aniversário da cidade" value={reason} onChange={event => setReason(event.target.value)} disabled={busy}/></label></div>{error && <p role="alert" className="form-error">{error}</p>}<button type="submit" className="btn secondary" disabled={busy}><Icon name="plus" size={16}/>Salvar data de folga</button></form>
  </section>;
}

export default function Admin() {
  const { state, isAdmin, busy, openModal, notify } = useHouse();
  const [exporting, setExporting] = useState(false);
  if (!isAdmin) return <Empty title="Área da administração" description="Peça ao admin para ajustar os combinados da casa."/>;
  const settingsKey = JSON.stringify({ ...state.settings, holidays: undefined });
  async function download() {
    setExporting(true);
    try { await exportData(); notify('Dados exportados. Guarde o arquivo em um lugar privado.'); }
    catch (failure) { notify(failure.message); }
    finally { setExporting(false); }
  }
  return <div className="admin-layout">
    <SettingsForm key={settingsKey} settings={state.settings}/>
    <div className="stack">
      <NotificationServerStatus/>
      <section className="panel admin-section"><div className="row between"><div><h2>Atividades recorrentes</h2><p className="hint">O que entra na divisão dos dias ativos.</p></div><button type="button" className="icon-btn" aria-label="Adicionar atividade recorrente" disabled={busy} onClick={() => openModal({ type: 'template' })}><Icon name="plus" size={19}/></button></div>
        {state.templates.map(template => <div className="template-row" key={template.id}><span className={'task-icon ' + resolveActivityIcon(template)}><Icon name={resolveActivityIcon(template)} size={21}/></span><div><strong>{template.title}</strong>{!template.active && <span className="pill">Inativa</span>}<small>{template.area} · {template.duration} min · até {template.deadline}</small><small className="template-weekdays">{weekdaySummary(template.weekdays)}</small></div><button type="button" className="icon-btn" aria-label={'Editar ' + template.title} disabled={busy} onClick={() => openModal({ type: 'template', template })}><Icon name="edit" size={16}/></button></div>)}
        {!state.templates.length && <p className="hint">Adicione uma atividade para começar os sorteios.</p>}
      </section>
      <Holidays/>
      <section className="panel admin-section"><h2>Os dados são da casa</h2><p className="hint">Baixe moradores, tarefas, pontos, regras e os calendários arquivados em JSON. Senhas e convites ficam fora. O arquivo serve para consulta; não substitui o backup do banco e não há importação pelo aplicativo.</p><button type="button" className="btn secondary full" disabled={busy || exporting} onClick={download}><Icon name="download" size={16}/>{exporting ? 'Exportando…' : 'Exportar dados'}</button></section>
      <section className="panel admin-section danger-zone"><div className="row"><Icon name="alert" size={22}/><h2>Recomeçar a divisão</h2></div><p>Zere o calendário inteiro para sortear as atividades novamente.</p><p className="hint">O calendário completo fica arquivado no banco e incluído na exportação JSON. As atividades e trocas saem da agenda ativa, e o ranking ativo volta a zero. Moradores e atividades recorrentes são preservados. A geração automática será desligada até você ativá-la novamente.</p><button type="button" className="btn danger full" disabled={busy} onClick={() => openModal({ type: 'reset' })}><Icon name="trash" size={16}/>Zerar todo o calendário</button></section>
    </div>
  </div>;
}
