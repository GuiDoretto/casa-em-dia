'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar, Empty, Icon } from './ui';
import { useHouse } from '../lib/house-context';
import { addDay, formatDate, monthLabel, monday, changeMonth, offReason } from '../lib/client.mjs';
import './calendar.css';

const modes = [
  { id: 'flow', label: 'Fluxo', icon: 'sparkles', caption: 'A rotina em movimento', hint: 'Deslize para cima para avançar. Para baixo, reveja os dias anteriores.' },
  { id: 'focus', label: 'Foco', icon: 'home', caption: 'Um dia de cada vez', hint: 'Deslize para os lados para trocar de dia.' },
  { id: 'month', label: 'Mês', icon: 'calendar', caption: 'O panorama da casa', hint: 'Toque em uma data para explorar suas atividades.' },
];

export function CalendarView({ TaskCard, MonthSwitcher }) {
  const { state, now, month, setMonth, selected, setSelected } = useHouse();
  const [mode, setMode] = useState('flow');
  const [ready, setReady] = useState(false);
  const [person, setPerson] = useState('');
  const [position, setPosition] = useState(0);
  const [direction, setDirection] = useState('next');
  const stream = useRef(null), deck = useRef(null), rail = useRef(null);
  const touchStart = useRef(null);
  const preferenceKey = 'casa-calendar-view:' + state.user.id;
  const first = month + '-01', last = addDay(changeMonth(month, 1) + '-01', -1);
  const days = Array.from({ length: Number(last.slice(8)) }, (_, i) => addDay(first, i));
  const tasks = state.tasks.filter(task => !person || task.assignee_id === person);
  const tasksOn = day => tasks.filter(task => task.due_date === day);
  const current = modes.find(item => item.id === mode);
  const todayTasks = tasksOn(now.date), completed = todayTasks.filter(task => task.status === 'done').length;
  const owners = state.users.filter(user => todayTasks.some(task => task.assignee_id === user.id));


  useEffect(() => {
    setMonth(now.date.slice(0, 7));
    setSelected(now.date);
    try {
      const saved = localStorage.getItem(preferenceKey);
      setMode(modes.some(item => item.id === saved) ? saved : 'flow');
    } catch { setMode('flow'); }
    setReady(true);
  }, [preferenceKey, now.date, setMonth, setSelected]);



  // Move only the calendar viewport, including after rotating the phone.
  useLayoutEffect(() => {
    if (!ready || mode !== 'flow') return;
    const day = selected.startsWith(month) ? selected : month === now.date.slice(0, 7) ? now.date : first;
    const viewport = stream.current;
    if (!viewport) return;
    const align = () => {
      const item = viewport.querySelector('[data-date="' + day + '"]');
      if (item) viewport.scrollTop += item.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    };
    align();
    let width = viewport.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== viewport.clientWidth) { width = viewport.clientWidth; align(); }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [ready, mode, month, position]);

  useLayoutEffect(() => {
    const viewport = rail.current;
    if (!viewport) return;
    const center = () => {
      const active = viewport.querySelector('[aria-pressed="true"]');
      if (active) viewport.scrollLeft = Math.max(0, active.offsetLeft - viewport.firstElementChild.offsetLeft - (viewport.clientWidth - active.clientWidth) / 2);
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [mode, selected, ready]);
  function chooseMode(next) {
    setMode(next);
    try { localStorage.setItem(preferenceKey, next); } catch { /* Navigation still works without storage. */ }
  }
  function goToday() {
    setMonth(now.date.slice(0, 7)); setSelected(now.date); setPosition(value => value + 1);
  }
  function goDay(day) {
    setDirection(day >= selected ? 'next' : 'previous');
    setSelected(day);
    if (!day.startsWith(month)) setMonth(day.slice(0, 7));
  }
  function finishSwipe(event) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const end = event.changedTouches[0];
    const x = end.clientX - start.x, y = end.clientY - start.y;
    if (Math.abs(x) > 45 && Math.abs(x) > Math.abs(y) * 1.2) goDay(addDay(selected, x < 0 ? 1 : -1));
  }  function dayLabel(day) {
    return day === now.date ? 'Hoje' : day === addDay(now.date, 1) ? 'Amanhã' : day === addDay(now.date, -1) ? 'Ontem' : formatDate(day, { weekday: 'long' });
  }
  function dayTasks(day) {
    const list = tasksOn(day);
    return <div className="agenda-task-list task-list">{list.length ? list.map(task => <TaskCard key={task.id} task={task} ownerPhoto />) : <Empty title={offReason(day, state.settings) || 'Um respiro na rotina'}>Nenhuma atividade para este dia{person ? ' com este morador' : ''}.</Empty>}</div>;
  }
  function dayHeading(day) {
    const list = tasksOn(day);
    return <header className="agenda-day-heading"><div><p className="eyebrow">{dayLabel(day)}</p><h2>{formatDate(day, { day: 'numeric', month: 'long' })}</h2></div><span className="agenda-count">{list.length} {list.length === 1 ? 'atividade' : 'atividades'}</span></header>;
  }

  return <div className={'agenda agenda-mode-' + mode} data-ready={ready}>
    <section className="agenda-pulse" aria-label="Resumo de hoje"><div><p className="eyebrow"><span className="agenda-live-dot" /> A CASA ACONTECE HOJE</p><h2>{todayTasks.length && completed === todayTasks.length ? 'Tudo cuidado por hoje.' : 'Cada dia, um novo cuidado.'}</h2><p>{formatDate(now.date, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><div className="agenda-pulse-summary"><div className="avatar-stack">{owners.slice(0, 4).map(user => <Avatar key={user.id} user={user} index={state.users.indexOf(user)} />)}</div><strong>{completed}<span> / {todayTasks.length}</span></strong><small>cuidados concluídos hoje</small></div></section>
    <div className="agenda-mode-picker" role="group" aria-label="Estilo do calendário">{modes.map(item => <button key={item.id} type="button" aria-label={item.label} aria-pressed={mode === item.id} onClick={() => chooseMode(item.id)}><Icon name={item.icon} size={19} /><span><strong>{item.label}</strong><small>{item.caption}</small></span></button>)}</div>
    <section className="panel agenda-surface">
      <div className="agenda-toolbar"><MonthSwitcher /><div className="agenda-controls"><button type="button" className="btn secondary small-btn" onClick={goToday}><Icon name="sparkles" size={14} />Hoje</button><label className="sr-only" htmlFor="agenda-person">Filtrar morador</label><select id="agenda-person" value={person} onChange={event => setPerson(event.target.value)}><option value="">Todos os moradores</option>{state.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></div></div>
      <p className="agenda-gesture-hint"><Icon name={mode === 'focus' ? 'swap' : 'calendar'} size={14} />{current.hint}</p>
      {mode === 'flow' && <div className="agenda-stream" ref={stream} tabIndex={0} role="region" aria-label="Linha do tempo de atividades"><p className="agenda-boundary">Início de {monthLabel(month)}</p>{days.map(day => <section key={day} data-date={day} className={'agenda-stream-day ' + (day === now.date ? 'is-today' : '')}>{dayHeading(day)}{dayTasks(day)}</section>)}<p className="agenda-boundary">Fim de {monthLabel(month)} · use as setas para explorar outro mês</p><div className="agenda-stream-space" aria-hidden="true" /></div>}
      {mode === 'focus' && <>
        <div className="agenda-date-rail" ref={rail} role="group" aria-label="Escolher dia">{days.map(day => <button key={day} type="button" onClick={() => goDay(day)} aria-pressed={selected === day} aria-current={day === now.date ? 'date' : undefined} aria-label={formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}><span>{day === now.date ? 'Hoje' : formatDate(day, { weekday: 'short' }).replace('.', '')}</span><strong>{Number(day.slice(8))}</strong><i className={tasksOn(day).length ? 'has-tasks' : ''} /></button>)}</div>
        <div className="agenda-focus-navigation"><button type="button" className="icon-btn" aria-label="Dia anterior" onClick={() => goDay(addDay(selected, -1))}><Icon name="left" size={19} /></button><span aria-live="polite">{formatDate(selected, { weekday: 'long', day: 'numeric', month: 'short' })}</span><button type="button" className="icon-btn" aria-label="Próximo dia" onClick={() => goDay(addDay(selected, 1))}><Icon name="right" size={19} /></button></div>
        <div className="agenda-focus-deck" ref={deck} tabIndex={0} role="region" aria-label="Dias da agenda, deslize para os lados" onTouchStart={event => { const point = event.touches[0]; touchStart.current = event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null; }} onTouchMove={event => { if (event.touches.length !== 1) touchStart.current = null; }} onTouchEnd={finishSwipe} onTouchCancel={() => { touchStart.current = null; }} onKeyDown={event => { if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); goDay(addDay(selected, event.key === 'ArrowRight' ? 1 : -1)); } }}><section key={selected} data-date={selected} data-direction={direction} className="agenda-focus-day">{dayHeading(selected)}{dayTasks(selected)}</section></div>
      </>}
      {mode === 'month' && <div className="agenda-month-layout"><section className="agenda-month-details" id="agenda-selected-day" aria-label="Atividades do dia selecionado">{dayHeading(selected)}{dayTasks(selected)}</section><div className="agenda-month-map"><div className="agenda-month-grid" role="group" aria-label={'Calendário de ' + monthLabel(month)}>{['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map(day => <span className="agenda-weekday" key={day}>{day}</span>)}{Array.from({ length: Math.ceil(((new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7 + days.length) / 7) * 7 }, (_, index) => addDay(monday(first), index)).map(day => {
        const list = tasksOn(day);
        return <button key={day} type="button" className={'agenda-month-day ' + (!day.startsWith(month) ? 'outside ' : '') + (selected === day ? 'selected ' : '') + (day === now.date ? 'today' : '')} aria-current={day === now.date ? 'date' : undefined} aria-pressed={selected === day} aria-controls="agenda-selected-day" aria-label={formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' }) + ', ' + list.length + ' atividades'} onClick={() => goDay(day)}><span className="agenda-month-number">{Number(day.slice(8))}</span><span className="agenda-month-avatars">{Array.from(new Set(list.map(task => task.assignee_id))).slice(0, 2).map(ownerId => <Avatar key={ownerId} user={state.users.find(user => user.id === ownerId)} index={state.users.findIndex(user => user.id === ownerId)} />)}</span>{list.length > 0 && <small>{list.length} <span>atividade{list.length > 1 ? 's' : ''}</span></small>}</button>;
      })}</div><p className="agenda-month-note"><Icon name="users" size={14} />As fotos mostram quem cuida de cada dia.</p></div></div>}
    </section>
  </div>;
}