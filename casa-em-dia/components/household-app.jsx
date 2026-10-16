'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import AuthScreen from './auth-screen';
import { Avatar, Brand, Icon } from './ui';
import { HouseContext } from '../lib/house-context';
import { api, formatDate, localNow } from '../lib/client.mjs';
import { Dashboard, Calendar, Draw, Residents, Ranking, Swaps } from './views';
import Admin from './admin';
import Dialogs from './dialogs';

const navigation = [
  ['home', 'home', 'Hoje'], ['calendar', 'calendar', 'Agenda'], ['draw', 'dice', 'Sorteador'],
  ['swaps', 'swap', 'Trocas'], ['people', 'users', 'Moradores'], ['ranking', 'trophy', 'Ranking'],
  ['admin', 'settings', 'Administração'],
];
const titles = {
  home: ['Tudo em dia, casa leve.', 'Um pouco de cada um faz toda a diferença.'],
  calendar: ['A agenda da casa', 'Os combinados de todo mundo, em um só lugar.'],
  draw: ['Dividir para cuidar', 'Um sorteio justo para ninguém ficar sobrecarregado.'],
  swaps: ['Combinado entre vocês', 'Imprevistos acontecem. Troque uma tarefa com outro morador.'],
  people: ['Quem faz a casa', 'Pessoas diferentes, o mesmo cuidado.'],
  ranking: ['Cada cuidado conta', 'Celebre quem está fazendo a sua parte.'],
  admin: ['Do jeito da sua casa', 'Ajuste os combinados e organize a rotina da república.'],
};
export default function HouseholdApp() {
  const [state, setState] = useState(null);
  const [view, setView] = useState('home');
  const [now, setNow] = useState(localNow);
  const [selected, setSelected] = useState(() => localNow().date);
  const [month, setMonth] = useState(() => localNow().date.slice(0, 7));
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState('');
  const [notificationPermission, setNotificationPermission] = useState('default');
  const busyRef = useRef(false), revision = useRef(0), stateRef = useRef(state), toastTimeout = useRef();
  stateRef.current = state;
  const notify = useCallback(message => {
    clearTimeout(toastTimeout.current); setToast(message);
    toastTimeout.current = setTimeout(() => setToast(''), 5500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimeout.current), []);
  const navigate = useCallback(next => {
    setView(next); setModal(null); if (next === 'home') setSelected(localNow().date); window.history.replaceState(null, '', '#' + next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  useEffect(() => {
    const initial = window.location.hash.slice(1);
    if (navigation.some(([id]) => id === initial)) setView(initial);
    if ('Notification' in window) setNotificationPermission(Notification.permission);
    const timer = setInterval(() => setNow(localNow()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!state?.user.id) return;
    const controller = new AbortController();
    const refresh = async () => {
      if (busyRef.current || document.hidden) return;
      const currentRevision = revision.current;
      try {
        const fresh = await api('state', undefined, {}, controller.signal);
        if (revision.current === currentRevision && !busyRef.current) { setState(fresh); setConnection(''); }
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (error.status === 401) { setState(null); notify('Sua sessão terminou. Entre novamente.'); }
        else setConnection('Sem conexão com o servidor. Tentando reconectar…');
      }
    };
    const timer = setInterval(refresh, 20000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); controller.abort(); document.removeEventListener('visibilitychange', refresh); };
  }, [state?.user.id, notify]);
  useEffect(() => {
    if (!state?.user.id || notificationPermission !== 'granted') return;
    const timer = setInterval(() => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const current = stateRef.current;
      if (!current) return;
      const pending = current.tasks.filter(t => t.assignee_id === current.user.id && t.status === 'pending' && t.due_date <= localNow().date);
      if (pending.length) {
        try { new Notification('Casa em Dia', { body: pending.length + ' atividade(s) esperando seu cuidado.', tag: 'casa-tarefas', icon: '/favicon.svg' }); } catch {}
      }
    }, state.settings.reminderMinutes * 60000);
    return () => clearInterval(timer);
  }, [state?.user.id, state?.settings.reminderMinutes, notificationPermission]);
  async function mutate(path, data) {
    if (busyRef.current) throw new Error('Aguarde a operação atual terminar.');
    busyRef.current = true; setBusy(true); revision.current++;
    try {
      const result = await api(path, data);
      if (result.user && result.tasks) setState(result);
      setConnection(''); return result;
    } catch (error) { if (error.status === 401) setState(null); throw error; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function act(path, data, message) {
    try { const result = await mutate(path, data); if (message) notify(message); return result; }
    catch (error) { notify(error.message); return null; }
  }
  async function enableNotifications() {
    if (!('Notification' in window)) { notify('Este navegador não oferece alertas do sistema. Os lembretes da agenda continuam aqui.'); return; }
    try {
      const permission = await Notification.requestPermission(); setNotificationPermission(permission);
      notify(permission === 'granted' ? 'Alertas ativados neste aparelho enquanto a agenda estiver aberta.' : 'Permita notificações nas configurações do navegador.');
    } catch { notify('Para ativar alertas, use HTTPS ou localhost.'); }
  }
  async function logout() {
    const result = await act('logout', {});
    if (result) { setState(null); setModal(null); navigate('home'); }
  }
  const isAdmin = state?.user.role === 'admin';
  const context = { state, now, selected, setSelected, month, setMonth, navigate, isAdmin, busy, mutate, act, notify, openModal: setModal, closeModal: () => setModal(null), enableNotifications, notificationPermission, logout };
  const pendingMine = state?.tasks.filter(t => t.assignee_id === state.user.id && t.status === 'pending' && t.due_date <= now.date) || [];
  const swapCount = state?.swaps.filter(s => s.status === 'pending' && s.recipient_id === state.user.id).length || 0;
  const currentView = !isAdmin && ['admin', 'draw'].includes(view) ? 'home' : view;
  const menu = navigation.filter(([id]) => isAdmin || !['admin', 'draw'].includes(id));
  return <HouseContext.Provider value={context}>
    {!state ? <AuthScreen onAuthenticated={fresh => { setState(fresh); window.history.replaceState(null, '', window.location.pathname + window.location.hash); }} notify={notify}/> :
      <div className="app-shell">
        <a className="skip-link" href="#main">Pular para o conteúdo</a>
        <aside className="sidebar">
          <Brand/>
          <div className="house-switch"><span className="house-symbol"><Icon name="home" size={18}/></span><div><strong>{state.settings.houseName}</strong><small>Nosso espaço compartilhado</small></div><span className="online-dot" title="Agenda da casa"/></div>
          <p className="nav-label">NOSSA ROTINA</p>
          <nav aria-label="Menu principal">{menu.map(([id, icon, title]) => <button key={id} onClick={() => navigate(id)} className={'nav-item ' + (currentView === id ? 'active' : '')} aria-current={currentView === id ? 'page' : undefined}><Icon name={icon} size={19}/><span>{title}</span>{id === 'swaps' && swapCount > 0 && <b className="nav-count">{swapCount}</b>}</button>)}</nav>
          <div className="sidebar-bottom"><div className="care-note"><Icon name="leaf" size={21}/><p>Casa boa é casa<br/><strong>cuidada em conjunto.</strong></p></div><button className="profile-button" onClick={() => setModal({ type: 'profile' })}><Avatar user={state.user}/><span><strong>{state.user.name}</strong><small>{isAdmin ? 'Admin da casa' : 'Morador'}</small></span><Icon name="chevron" size={16}/></button></div>
        </aside>
        <div className="workspace">
          <header className="topbar"><div className="desktop-breadcrumb">Nossa casa <Icon name="chevron" size={14}/><strong>{navigation.find(([id]) => id === currentView)?.[2]}</strong></div><div className="mobile-brand"><Brand/></div><div className="topbar-actions"><span className="topbar-date">{formatDate(now.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span><button className="icon-btn notification-btn" aria-label={'Notificações: ' + pendingMine.length + ' atividades pendentes'} onClick={() => setModal({ type: 'notifications' })}><Icon name="bell"/>{pendingMine.length > 0 && <i/>}</button><button className="avatar-button" aria-label="Abrir meu perfil" onClick={() => setModal({ type: 'profile' })}><Avatar user={state.user}/></button></div></header>
          {connection && <div className="connection-banner" role="status"><Icon name="clock" size={16}/>{connection}</div>}
          <main id="main" className="main">
            <div className="page-heading"><div><p className="eyebrow">{currentView === 'home' ? 'BEM-VINDO À NOSSA ROTINA' : 'CUIDAR É COMPARTILHAR'}</p><h1>{titles[currentView][0]}</h1><p>{titles[currentView][1]}</p></div>{isAdmin && ['home', 'calendar'].includes(currentView) && <button className="btn" onClick={() => setModal({ type: 'task' })}><Icon name="plus" size={17}/><span>Nova atividade</span></button>}</div>
            {currentView === 'home' && <Dashboard/>}{currentView === 'calendar' && <Calendar/>}{currentView === 'draw' && <Draw/>}{currentView === 'swaps' && <Swaps/>}{currentView === 'people' && <Residents/>}{currentView === 'ranking' && <Ranking/>}{currentView === 'admin' && <Admin/>}
            <footer className="main-footer"><span><Icon name="leaf" size={14}/>Feito para dividir tarefas. E somar cuidado.</span><span>Casa em Dia · A casa é de todos.</span></footer>
          </main>
        </div>
        <nav className="mobile-nav" aria-label="Menu para celular">{menu.map(([id, icon, title]) => <button key={id} onClick={() => navigate(id)} className={currentView === id ? 'active' : ''} aria-current={currentView === id ? 'page' : undefined}><Icon name={icon} size={21}/><span>{id === 'admin' ? 'Admin' : title}</span>{id === 'swaps' && swapCount > 0 && <b>{swapCount}</b>}</button>)}</nav>
        {modal && <Dialogs key={modal.type + (modal.task?.id || modal.template?.id || modal.user?.id || '')} modal={modal}/>}
      </div>}
    {toast && <div className="toast" role="status" aria-live="polite"><Icon name="info" size={18}/>{toast}<button aria-label="Fechar aviso" onClick={() => setToast('')}><Icon name="close" size={16}/></button></div>}
  </HouseContext.Provider>;
}
