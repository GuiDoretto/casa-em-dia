'use client';
import { useState } from 'react';
import { Avatar, Empty, Field, Icon, Submit } from './ui';
import { useHouse } from '../lib/house-context';
import { formatDate, monthLabel, scores, userFor } from '../lib/client.mjs';
import { MonthSwitcher } from './views';

export function Draw() {
  const { state, now, busy, mutate, notify, navigate, setSelected, setMonth } = useHouse();
  const [date, setDate] = useState(now.date), [period, setPeriod] = useState('day'), [result, setResult] = useState(null);
  const mode = state.settings.drawPeriod || 'all';
  const limit = mode === 'all' ? 'Todas as atividades elegíveis nos dias definidos' : 'Até ' + state.settings.drawCount + ' atividades por ' + (mode === 'weekly' ? 'semana' : 'dia');
  async function draw(e) {
    e.preventDefault();
    try {
      const res = await mutate('draw', { date, month: period === 'month', week: period === 'week' });
      setResult(res); notify(res.created.length + ' atividade(s) distribuída(s).');
    } catch (error) { notify(error.message); }
  }
  return <div className="draw-layout"><section className="panel draw-card"><div className="dice-mark"><Icon name="dice" size={52}/></div>
    <p className="eyebrow">SEM PESAR PARA NINGUÉM</p><h2>Deixa que a sorte divide.</h2>
    <p>Quem tem menos tarefas no mês tem prioridade. Em caso de empate, a sorte escolhe. Não é preciso dar tarefas para todo mundo na semana.</p>
    <form onSubmit={draw} className="draw-form">
      <Field label="A partir de qual dia?" name="date" type="date" value={date} onChange={e => setDate(e.target.value)} min={now.date} max={String(Number(now.date.slice(0, 4)) + 1) + '-12-31'} required/>
      <label className="field">Período para organizar<select name="drawRange" value={period} onChange={e => setPeriod(e.target.value)}><option value="day">Somente o dia escolhido</option><option value="week">Do dia escolhido até domingo</option><option value="month">Do dia escolhido até o fim do mês</option></select></label>
      <div className="draw-configuration"><Icon name="settings" size={16}/><p>{limit}<small>Os dias de cada atividade e o limite são definidos na Administração. A semana vai de segunda a domingo.</small></p></div>
      <Submit busy={busy}><Icon name="dice" size={18}/>Sortear atividades</Submit>
    </form>
    <small className="hint">As tarefas já distribuídas são mantidas e contam no limite. Para recomeçar do zero, use a Administração.</small>
  </section><aside className="stack"><section className="panel"><h3>Um sorteio com os nossos combinados</h3><ul className="rules-list">
    <li><Icon name="users"/>Escolhe entre os {state.users.filter(u => u.active).length} moradores ativos, conforme a quantidade de tarefas.</li>
    <li><Icon name="check"/>Usa {state.templates.filter(t => t.active).length} atividades recorrentes e respeita os dias de cada uma.</li>
    <li><Icon name="calendar"/>{limit}.</li>
    <li><Icon name="leaf"/>Respeita folgas, feriados e pausas.</li><li><Icon name="shield"/>Preserva o que já foi sorteado.</li>
  </ul></section>{result && <section className="panel"><p className="eyebrow">SORTEIO CONCLUÍDO</p><h3>{result.created.length} atividade(s) na agenda</h3><p className="hint">{result.skipped.length} dia(s) sem limpeza foram respeitados.</p>
    {!result.created.length && <p className="hint">O limite pode já estar preenchido ou pode não haver atividades para os dias escolhidos. No limite semanal, organize até domingo para conferir a distribuição da semana.</p>}
    <button className="btn secondary" onClick={() => { setSelected(date); setMonth(date.slice(0, 7)); navigate('calendar'); }}>Conferir a agenda <Icon name="arrow" size={16}/></button>
  </section>}</aside></div>;
}

export function Residents() {
  const { state, month, isAdmin, busy, openModal, act } = useHouse();
  const [search, setSearch] = useState('');
  const ranking = scores(state, month), residents = state.users.filter(u => u.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  async function invite(user) { const result = await act('invite', { id: user.id }); if (result) openModal({ type: 'invite', token: result.inviteToken, name: user.name }); }
  return <><div className="toolbar"><label className="search-field"><Icon name="users" size={17}/><input aria-label="Buscar morador" placeholder="Buscar um morador…" value={search} onChange={e => setSearch(e.target.value)}/></label><span className="hint">{monthLabel(month)}</span>{isAdmin && <button className="btn" onClick={() => openModal({ type: 'user' })}><Icon name="plus" size={17}/>Adicionar morador</button>}</div><div className="people-grid">{residents.map((u, i) => {
    const score = ranking.find(s => s.id === u.id);
    return <article className="panel person-card" key={u.id}><div className="row between"><Avatar user={u} index={i}/><span className={'pill ' + (u.active ? 'green' : '')}>{u.active ? u.role === 'admin' ? 'Admin' : 'Morador' : 'Inativo'}</span></div><h2>{u.name}{u.id === state.user.id && <small> (você)</small>}</h2>{isAdmin && <div className="person-contact"><span><Icon name="mail" size={14}/>{u.email}</span>{u.phone && <span><Icon name="phone" size={14}/>{u.phone}</span>}<span className="hint">{u.registered ? 'Conta ativada' : 'Aguardando aceitar o convite'}</span></div>}<div className="person-stats"><div><strong>{score?.done || 0}</strong><small>concluídas no mês</small></div><div><strong>{score?.points || 0}</strong><small>pontos no mês</small></div></div>{isAdmin && <div className="person-actions"><button className="btn secondary small-btn" onClick={() => openModal({ type: 'user', user: u })}><Icon name="edit" size={14}/>Editar</button>{u.id !== state.user.id && !!u.active && <button disabled={busy} className="text-btn" onClick={() => invite(u)}>{u.registered ? 'Novo acesso' : 'Novo convite'}<Icon name="arrow" size={14}/></button>}</div>}</article>;
  })}</div>{!residents.length && <Empty title="Nenhum morador encontrado">Tente buscar por outro nome.</Empty>}</>;
}
export function Ranking() {
  const { state, month } = useHouse();
  const ranking = scores(state, month);
  return <><div className="toolbar"><MonthSwitcher/><span className="pill green"><Icon name="trophy" size={14}/>10 pontos por cuidado no prazo</span></div><div className="rank-banner"><Icon name="trophy" size={44}/><div><p className="eyebrow">TODO MUNDO GANHA UMA CASA MELHOR</p><h2>{ranking[0]?.points > 0 ? ranking[0].name.split(' ')[0] + ' está puxando o cuidado por aqui.' : 'O próximo cuidado pode ser o seu.'}</h2><p>O ranking usa o mês da atividade. Concluir depois do prazo soma zero pontos.</p></div></div><section className="panel ranking-panel">{ranking.map((u, i) => <div key={u.id} className={'ranking-row large ' + (u.id === state.user.id ? 'mine' : '')}><span className="rank-position">{i === 0 && u.points > 0 ? <Icon name="trophy" size={22}/> : String(i + 1).padStart(2, '0')}</span><Avatar user={u} index={i}/><div className="rank-user"><strong>{u.name}{u.id === state.user.id ? ' (você)' : ''}</strong><small>{u.done} atividade(s) concluída(s){!u.active && ' · Morador inativo'}</small></div><strong className="rank-points">{u.points}<small> pontos</small></strong></div>)}</section></>;
}
export function Swaps() {
  const { state, busy, act } = useHouse();
  const swaps = state.swaps.filter(s => [s.recipient_id, s.requester_id].includes(state.user.id));
  const labels = { pending: 'Aguardando resposta', accepted: 'Aceita', rejected: 'Recusada', cancelled: 'Cancelada' };
  return <><div className="info-note"><Icon name="swap" size={21}/><p>Para propor uma troca, use o botão de setas em uma tarefa sua. As duas atividades precisam estar pendentes, dentro do prazo e no mesmo mês.</p></div>{!swaps.length ? <Empty title="Nenhuma troca por aqui">Se a rotina apertar, combine uma troca com outro morador.</Empty> : <div className="swaps-list">{swaps.map(s => {
    const a = state.tasks.find(t => t.id === s.task_a), b = state.tasks.find(t => t.id === s.task_b), incoming = s.recipient_id === state.user.id;
    return <article className="panel swap-card" key={s.id}><div className="row between wrap"><h3>{incoming ? userFor(state, s.requester_id).name + ' propôs uma troca' : 'Você propôs uma troca para ' + userFor(state, s.recipient_id).name}</h3><span className={'pill ' + (s.status === 'accepted' ? 'green' : s.status === 'pending' ? 'amber' : '')}>{labels[s.status]}</span></div><div className="swap-flow">{[a, b].map((t, i) => <div className="swap-task" key={i}><small>{i === 0 ? 'Atividade oferecida' : 'Atividade solicitada'}</small><strong>{t?.title || 'Atividade removida'}</strong><span>{t && formatDate(t.due_date)} · {t?.deadline}</span></div>)}<span className="swap-arrow"><Icon name="swap" size={22}/></span></div>{s.status === 'pending' && <div className="swap-actions">{incoming ? <><button disabled={busy} className="btn secondary" onClick={() => act('resolve-swap', { id: s.id, action: 'rejected' }, 'Troca recusada.')}>Recusar</button><button disabled={busy} className="btn" onClick={() => act('resolve-swap', { id: s.id, action: 'accepted' }, 'Troca aceita. Responsáveis atualizados!')}><Icon name="check" size={16}/>Aceitar troca</button></> : <button disabled={busy} className="btn secondary" onClick={() => act('resolve-swap', { id: s.id, action: 'cancelled' }, 'Pedido cancelado.')}>Cancelar pedido</button>}</div>}</article>;
  })}</div>}</>;
}
