'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import AuthScreen from './auth-screen';
import { Avatar, Brand, Icon, Modal } from './ui';
import { HouseContext } from '../lib/house-context';
import { api, formatDate, localNow } from '../lib/client.mjs';
import { Dashboard, Calendar, Draw, Residents, Ranking, Swaps } from './views';
import Admin from './admin';
import Dialogs from './dialogs';
import InstallPrompt, { useInstallPrompt } from './install-prompt';
import { Rooms, Finances } from './rooms-finance';

const PUSH_OWNER_KEY = 'casa-em-dia:push-user';
function pushUnavailable() {
  if (!window.isSecureContext) return 'Os avisos neste aparelho exigem HTTPS. O acesso por IP em HTTP não permite ativá-los.';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (ios && !installed) return 'No iPhone ou iPad, adicione o app à Tela de Início e abra-o pelo novo ícone para ativar os avisos.';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'Este navegador não oferece avisos com o app fechado.';
  return '';
}
function publicKeyBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}
function subscriptionKeyMatches(subscription, publicKey) {
  const key = subscription?.options?.applicationServerKey;
  if (!key || !publicKey) return false;
  try {
    const actual = ArrayBuffer.isView(key) ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength) : new Uint8Array(key);
    const expected = publicKeyBytes(publicKey);
    return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
  } catch { return false; }
}

const navigation = [
  ['home', 'home', 'Hoje'], ['calendar', 'calendar', 'Agenda'], ['draw', 'dice', 'Sorteador'],
  ['swaps', 'swap', 'Trocas'], ['people', 'users', 'Moradores'], ['ranking', 'trophy', 'Ranking'],
  ['rooms', 'bed', 'Quartos'], ['finances', 'calculator', 'Despesas'],
  ['admin', 'settings', 'Administração'],
];
const titles = {
  home: ['Tudo em dia, casa leve.', 'Um pouco de cada um faz toda a diferença.'],
  calendar: ['A agenda da casa', 'Os combinados de todo mundo, em um só lugar.'],
  draw: ['Dividir para cuidar', 'Um sorteio justo para ninguém ficar sobrecarregado.'],
  swaps: ['Combinado entre vocês', 'Imprevistos acontecem. Troque uma tarefa com outro morador.'],
  people: ['Quem faz a casa', 'Pessoas diferentes, o mesmo cuidado.'],
  rooms: ['Um espaço para cada um', 'Quartos, valores e diferenciais. Veja quem mora e onde há vagas.'],
  finances: ['As contas da nossa casa', 'Aluguel de cada quarto e despesas do mês, divididos com clareza.'],
  ranking: ['Cada cuidado conta', 'Celebre quem está fazendo a sua parte.'],
  admin: ['Do jeito da sua casa', 'Ajuste os combinados e organize a rotina da república.'],
};
export default function HouseholdApp() {
  const installation = useInstallPrompt();
  const [state, setState] = useState(null);
  const [view, setView] = useState('home');
  const [now, setNow] = useState(localNow);
  const [selected, setSelected] = useState(() => localNow().date);
  const [month, setMonth] = useState(() => localNow().date.slice(0, 7));
  const [modal, setModal] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState('');
  const [notificationPermission, setNotificationPermission] = useState('default');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushUnavailableReason, setPushUnavailableReason] = useState('');
  const pushBusyRef = useRef(false), pushRegistrationRef = useRef(null), pushOwnerRef = useRef(null);
  const busyRef = useRef(false), revision = useRef(0), stateRef = useRef(state), toastTimeout = useRef();
  stateRef.current = state;
  const notify = useCallback(message => {
    clearTimeout(toastTimeout.current); setToast(message);
    toastTimeout.current = setTimeout(() => setToast(''), 5500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimeout.current), []);
  const navigate = useCallback(next => {
    setView(next); setModal(null); setMobileMenu(false); if (next === 'home') setSelected(localNow().date); window.history.replaceState(null, '', '#' + next);
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
      if (busyRef.current || pushBusyRef.current || document.hidden) return;
      const currentRevision = revision.current;
      try {
        const fresh = await api('state', undefined, {}, controller.signal);
        if (revision.current === currentRevision && !busyRef.current && !pushBusyRef.current) { setState(fresh); setConnection(''); }
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
  const registerPushWorker = useCallback(() => {
    if (!pushRegistrationRef.current) pushRegistrationRef.current = navigator.serviceWorker.register('/sw.js').catch(error => { pushRegistrationRef.current = null; throw error; });
    return pushRegistrationRef.current;
  }, []);
  function pushOwner() {
    try { return window.localStorage.getItem(PUSH_OWNER_KEY) || pushOwnerRef.current; } catch { return pushOwnerRef.current; }
  }
  function savePushOwner(userId) {
    pushOwnerRef.current = userId;
    try {
      if (userId) window.localStorage.setItem(PUSH_OWNER_KEY, userId);
      else window.localStorage.removeItem(PUSH_OWNER_KEY);
    } catch { }
  }
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const openTasks = event => { if (event.data?.type === 'OPEN_TASKS') navigate('home'); };
    navigator.serviceWorker.addEventListener('message', openTasks);
    return () => navigator.serviceWorker.removeEventListener('message', openTasks);
  }, [navigate]);
  useEffect(() => {
    let active = true;
    setPushEnabled(false);
    const reason = pushUnavailable();
    setPushUnavailableReason(reason);
    if (!state?.user.id || reason || !state.notifications?.push?.configured) return;
    const sync = async () => {
      if (pushBusyRef.current) return;
      try {
        const registration = await registerPushWorker();
        const subscription = await registration.pushManager.getSubscription();
        const keyMatches = subscriptionKeyMatches(subscription, state.notifications?.push?.publicKey);
        const device = subscription ? await api('push-device', { endpoint: subscription.endpoint }) : { subscribed: false };
        if (!active || pushBusyRef.current) return;
        if (subscription && !device.subscribed) {
          pushBusyRef.current = true; setPushBusy(true);
          try {
            const removed = await subscription.unsubscribe();
            if (!removed && await registration.pushManager.getSubscription()) throw new Error('Não foi possível desativar os avisos da sessão anterior. Clique em Ativar neste aparelho para tentar atualizar.');
          } catch (error) { notify(error.message || 'Não foi possível desativar os avisos da sessão anterior. Tente novamente.'); }
          finally { pushBusyRef.current = false; setPushBusy(false); }
          savePushOwner(null);
          if (active) setPushEnabled(false);
          return;
        }
        setNotificationPermission(Notification.permission);
        setPushEnabled(Boolean(device.subscribed && keyMatches && Notification.permission === 'granted'));
        if (device.subscribed) savePushOwner(state.user.id);
      } catch { if (active) setPushEnabled(false); }
    };
    sync();
    window.addEventListener('focus', sync);
    const onVisible = () => { if (!document.hidden) sync(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', onVisible); };
  }, [state?.user.id, state?.notifications?.push?.configured, state?.notifications?.push?.publicKey, state?.notifications?.subscriptionCount, registerPushWorker, notify]);
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
  async function readyPushWorker() {
    const registration = await registerPushWorker();
    if (registration.active) return registration;
    let timeout;
    try {
      return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('A ativação do aparelho demorou. Tente novamente.')), 20000); }),
      ]);
    } finally { clearTimeout(timeout); }
  }
  async function enableNotifications() {
    if (busyRef.current || pushBusyRef.current || !state?.user.id) return;
    const reason = pushUnavailable();
    setPushUnavailableReason(reason);
    if (reason) { notify(reason); return; }
    const publicKey = state.notifications?.push?.publicKey;
    if (!state.notifications?.push?.configured || !publicKey) { notify('Configuração de avisos pendente no servidor.'); return; }
    pushBusyRef.current = true; setPushBusy(true);
    let subscription, created = false, saved = false;
    const userId = state.user.id;
    try {
      // Keep the permission request directly in the button's user gesture on iOS.
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== 'granted') { notify('Permita os avisos deste site nas configurações do navegador para ativá-los.'); return; }
      const registration = await readyPushWorker();
      subscription = await registration.pushManager.getSubscription();
      const device = subscription ? await api('push-device', { endpoint: subscription.endpoint }) : { subscribed: false };
      if (subscription && (!subscriptionKeyMatches(subscription, publicKey) || !device.subscribed)) {
        if (device.subscribed) await mutate('push-unsubscribe', { endpoint: subscription.endpoint });
        const removed = await subscription.unsubscribe();
        if (!removed && await registration.pushManager.getSubscription()) throw new Error('Não foi possível atualizar os avisos deste aparelho. Tente novamente.');
        subscription = null; savePushOwner(null); setPushEnabled(false);
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(publicKey) });
        created = true;
      }
      if (stateRef.current?.user.id !== userId) throw new Error('Sua sessão mudou. Entre novamente para ativar os avisos.');
      await mutate('push-subscribe', { subscription: subscription.toJSON() });
      saved = true; savePushOwner(userId); setPushEnabled(true);
      notify('Avisos ativados neste aparelho, inclusive com a agenda fechada.');
    } catch (error) {
      if (created && !saved) { try { await subscription?.unsubscribe(); } catch { } }
      notify(error.message || 'Não foi possível ativar os avisos neste aparelho.');
    } finally { pushBusyRef.current = false; setPushBusy(false); }
  }
  async function removeDeviceSubscription() {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) { setPushEnabled(false); savePushOwner(null); return; }
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) { setPushEnabled(false); savePushOwner(null); return; }
    let remoteFailure, localFailure;
    if (pushOwner() === stateRef.current?.user.id) {
      try { await mutate('push-unsubscribe', { endpoint: subscription.endpoint }); }
      catch (error) { remoteFailure = error; }
    }
    try {
      const removed = await subscription.unsubscribe();
      if (!removed && await registration.pushManager.getSubscription()) localFailure = new Error('O navegador não conseguiu desativar os avisos.');
    } catch (error) { localFailure = error; }
    if (localFailure && (remoteFailure || pushOwner() !== stateRef.current?.user.id)) throw new Error('Não foi possível desativar os avisos deste aparelho. Tente novamente antes de sair.');
    setPushEnabled(false); savePushOwner(null);
  }
  async function disableNotifications() {
    if (busyRef.current || pushBusyRef.current) return;
    pushBusyRef.current = true; setPushBusy(true);
    try { await removeDeviceSubscription(); notify('Avisos desativados neste aparelho.'); }
    catch (error) { notify(error.message); }
    finally { pushBusyRef.current = false; setPushBusy(false); }
  }
  async function testNotifications(channel) {
    if (busyRef.current || pushBusyRef.current) return;
    pushBusyRef.current = true; setPushBusy(true);
    const userId = state.user.id;
    try {
      const data = { channel };
      if (channel === 'push') {
        if (!pushEnabled || pushOwner() !== state.user.id) throw new Error('Ative primeiro os avisos neste aparelho.');
        const registration = await readyPushWorker();
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) throw new Error('Ative novamente os avisos neste aparelho.');
        data.endpoint = subscription.endpoint;
      }
      const result = await mutate('notification-test', data);
      notify(result.message || 'O teste foi aceito pelo serviço. Aguarde a entrega.');
      return result;
    } catch (error) { notify(error.message); return null; }
    finally {
      try {
        const fresh = await api('state');
        setState(current => current?.user.id === userId ? { ...current, notifications: fresh.notifications } : current);
      } catch { }
      pushBusyRef.current = false; setPushBusy(false);
    }
  }
  async function logout() {
    if (busyRef.current || pushBusyRef.current) return;
    pushBusyRef.current = true; setPushBusy(true);
    try {
      await removeDeviceSubscription();
      const result = await act('logout', {});
      if (result) { setState(null); setModal(null); navigate('home'); }
    } catch (error) { notify(error.message); }
    finally { pushBusyRef.current = false; setPushBusy(false); }
  }
  const isAdmin = state?.user.role === 'admin';
  const context = { state, now, selected, setSelected, month, setMonth, navigate, isAdmin, busy: busy || pushBusy, mutate, act, notify, openModal: setModal, closeModal: () => setModal(null), enableNotifications, disableNotifications, testNotifications, pushEnabled, pushUnavailableReason, notificationPermission, logout };
  const pendingMine = state?.tasks.filter(t => t.assignee_id === state.user.id && t.status === 'pending' && t.due_date <= now.date) || [];
  const swapCount = state?.swaps.filter(s => s.status === 'pending' && s.recipient_id === state.user.id).length || 0;
  const currentView = !isAdmin && ['admin', 'draw'].includes(view) ? 'home' : view;
  const menu = navigation.filter(([id]) => isAdmin || !['admin', 'draw'].includes(id));
  const mobilePrimary = menu.filter(([id]) => ['home', 'calendar', 'swaps', 'finances'].includes(id));
  const mobileExtra = menu.filter(([id]) => !['home', 'calendar', 'swaps', 'finances'].includes(id));
  return <HouseContext.Provider value={context}>
    {!state ? <AuthScreen onAuthenticated={fresh => { setState(fresh); window.history.replaceState(null, '', window.location.pathname + window.location.hash); }} notify={notify} /> :
      <div className="app-shell">
        <a className="skip-link" href="#main">Pular para o conteúdo</a>
        <aside className="sidebar">
          <Brand />
          <div className="house-switch"><span className="house-symbol"><Icon name="home" size={18} /></span><div><strong>{state.settings.houseName}</strong><small>Nosso espaço compartilhado</small></div><span className="online-dot" title="Agenda da casa" /></div>
          <p className="nav-label">NOSSA ROTINA</p>
          <nav aria-label="Menu principal">{menu.map(([id, icon, title]) => <button key={id} onClick={() => navigate(id)} className={'nav-item ' + (currentView === id ? 'active' : '')} aria-current={currentView === id ? 'page' : undefined}><Icon name={icon} size={19} /><span>{title}</span>{id === 'swaps' && swapCount > 0 && <b className="nav-count">{swapCount}</b>}</button>)}</nav>
          <div className="sidebar-bottom"><div className="care-note"><Icon name="leaf" size={21} /><p>Casa boa é casa<br /><strong>cuidada em conjunto.</strong></p></div><button className="profile-button" onClick={() => setModal({ type: 'profile' })}><Avatar user={state.user} /><span><strong>{state.user.name}</strong><small>{isAdmin ? 'Admin da casa' : 'Morador'}</small></span><Icon name="chevron" size={16} /></button></div>
        </aside>
        <div className="workspace">
          <header className="topbar"><div className="desktop-breadcrumb">Nossa casa <Icon name="chevron" size={14} /><strong>{navigation.find(([id]) => id === currentView)?.[2]}</strong></div><div className="mobile-brand"><Brand /></div><div className="topbar-actions"><span className="topbar-date">{formatDate(now.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span><button className="icon-btn notification-btn" aria-label={'Notificações: ' + pendingMine.length + ' atividades pendentes e ' + swapCount + ' pedidos de troca'} onClick={() => setModal({ type: 'notifications' })}><Icon name="bell" />{pendingMine.length + swapCount > 0 && <i />}</button><button className="avatar-button" aria-label="Abrir meu perfil" onClick={() => setModal({ type: 'profile' })}><Avatar user={state.user} /></button></div></header>
          {connection && <div className="connection-banner" role="status"><Icon name="clock" size={16} />{connection}</div>}
          <main id="main" className="main">
            <InstallPrompt installation={installation} />
            <div className="page-heading"><div><p className="eyebrow">{currentView === 'home' ? 'BEM-VINDO À NOSSA ROTINA' : 'CUIDAR É COMPARTILHAR'}</p><h1>{titles[currentView][0]}</h1><p>{titles[currentView][1]}</p></div>{isAdmin && ['home', 'calendar'].includes(currentView) && <button className="btn" onClick={() => setModal({ type: 'task' })}><Icon name="plus" size={17} /><span>Nova atividade</span></button>}</div>
            {currentView === 'home' && <Dashboard />}{currentView === 'calendar' && <Calendar />}{currentView === 'draw' && <Draw />}{currentView === 'swaps' && <Swaps />}{currentView === 'people' && <Residents />}{currentView === 'ranking' && <Ranking />}{currentView === 'admin' && <Admin />}{currentView === 'rooms' && <Rooms />}{currentView === 'finances' && <Finances />}
            <footer className="main-footer"><span><Icon name="leaf" size={14} />Feito para dividir tarefas. E somar cuidado.</span><span>Casa em Dia · A casa é de todos.</span></footer>
          </main>
        </div>
        <nav className="mobile-nav" aria-label="Menu para celular">{mobilePrimary.map(([id, icon, title]) => <button key={id} onClick={() => navigate(id)} className={currentView === id ? 'active' : ''} aria-current={currentView === id ? 'page' : undefined}><Icon name={icon} size={21} /><span>{title}</span>{id === 'swaps' && swapCount > 0 && <b>{swapCount}</b>}</button>)}<button onClick={() => setMobileMenu(true)} className={mobileExtra.some(([id]) => id === currentView) ? 'active' : ''} aria-expanded={mobileMenu} aria-haspopup="dialog"><Icon name="menu" size={21} /><span>Mais</span></button></nav>
        {mobileMenu && <Modal title="Mais opções" onClose={() => setMobileMenu(false)}><nav className="mobile-extra-menu" aria-label="Mais opções">{mobileExtra.map(([id, icon, title]) => <button className="btn secondary" key={id} onClick={() => navigate(id)} aria-current={currentView === id ? 'page' : undefined}><Icon name={icon} />{title}</button>)}</nav></Modal>}
        {modal && <Dialogs key={modal.type + (modal.task?.id || modal.template?.id || modal.user?.id || '')} modal={modal} />}
      </div>}
    {toast && <div className="toast" role="status" aria-live="polite"><Icon name="info" size={18} />{toast}<button aria-label="Fechar aviso" onClick={() => setToast('')}><Icon name="close" size={16} /></button></div>}
  </HouseContext.Provider>;
}
