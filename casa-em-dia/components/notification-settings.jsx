'use client';
import { useEffect, useState } from 'react';
import { useHouse } from '../lib/house-context';
import { Icon } from './ui';
import './notification-settings.css';

const channelNames = { email: 'E-mail', sms: 'SMS', push: 'Neste aparelho' };
const statusNames = { accepted: 'Aceito pelo serviço', failed: 'Falhou', uncertain: 'Confirmação pendente', rejected: 'Recusado pelo serviço', cancelled: 'Cancelado', retry: 'Nova tentativa agendada', queued: 'Na fila', sending: 'Enviando' };

function deliveryTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function NotificationServerStatus() {
  const { state } = useHouse();
  const notifications = state.notifications || {};
  return <section className="panel admin-section notification-server-status">
    <div className="row"><Icon name="bell" size={21} /><h2>Envio de lembretes</h2></div>
    <p className="hint">Cada morador escolhe os canais no próprio perfil ou no sino. O servidor precisa permanecer ligado para enviar os avisos.</p>
    <dl>{[['email', 'E-mail'], ['sms', 'SMS'], ['push', 'Avisos no aparelho']].map(([channel, label]) => <div key={channel}><dt>{label}</dt><dd className={notifications[channel]?.configured ? 'notification-ready' : ''}>{notifications[channel]?.configured ? 'Configurado' : 'Configuração pendente'}</dd></div>)}</dl>
    {['email', 'sms'].filter(channel => notifications[channel]?.issue).map(channel => <p className="hint" key={channel}>{channelNames[channel]}: {notifications[channel].issue}</p>)}
    <p className="hint">E-mail e SMS dependem de uma conta de envio configurada no servidor. SMS utiliza créditos pagos do provedor. No iPhone, os avisos exigem HTTPS e o app adicionado à Tela de Início.</p>
  </section>;
}

export default function NotificationSettings() {
  const { state, busy, mutate, notify, enableNotifications, disableNotifications, testNotifications, notificationPermission, pushEnabled, pushUnavailableReason } = useHouse();
  const notifications = state.notifications || {};
  const preferences = notifications.preferences || {};
  const [emailEnabled, setEmailEnabled] = useState(Boolean(preferences.emailEnabled));
  const [smsEnabled, setSmsEnabled] = useState(Boolean(preferences.smsEnabled));
  const [reminderTime, setReminderTime] = useState(preferences.reminderTime || '09:00');
  const [phone, setPhone] = useState(state.user.phone || '');
  const [error, setError] = useState('');
  useEffect(() => {
    setEmailEnabled(Boolean(preferences.emailEnabled));
    setSmsEnabled(Boolean(preferences.smsEnabled));
    setReminderTime(preferences.reminderTime || '09:00');
    setPhone(state.user.phone || '');
  }, [preferences.emailEnabled, preferences.smsEnabled, preferences.reminderTime, state.user.phone]);
  const emailConfigured = Boolean(notifications.email?.configured);
  const smsConfigured = Boolean(notifications.sms?.configured);
  const pushConfigured = Boolean(notifications.push?.configured && notifications.push?.publicKey);
  const dirty = emailEnabled !== Boolean(preferences.emailEnabled) || smsEnabled !== Boolean(preferences.smsEnabled) || reminderTime !== (preferences.reminderTime || '09:00') || phone !== (state.user.phone || '');
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    try {
      await mutate('notification-preferences', { emailEnabled, smsEnabled, reminderTime, phone });
      notify('Suas preferências de lembretes foram salvas.');
    } catch (failure) { setError(failure.message); }
  }
  return <section className="notification-settings" aria-label="Preferências de lembretes">
    <div className="notification-section-heading"><h3>Como quer receber lembretes?</h3><p className="hint">Você escolhe os avisos enviados para os seus contatos. Nenhum canal é ativado sem a sua escolha.</p></div>
    <form className="notification-preferences-form" onSubmit={save}>
      <div className="notification-channel">
        <label className="check-row"><span><strong><Icon name="mail" size={16} />Receber resumo por e-mail</strong><small>{state.user.email}</small></span><input type="checkbox" name="notificationEmailEnabled" checked={emailEnabled} onChange={event => setEmailEnabled(event.target.checked)} disabled={busy || (!emailConfigured && !emailEnabled)} /></label>
        {!emailConfigured && <p className="notification-channel-note">{notifications.email?.issue || 'Configuração pendente no servidor.'}</p>}
        <button type="button" className="btn secondary compact" disabled={busy || !emailConfigured || !preferences.emailEnabled || !state.user.email || dirty} onClick={() => testNotifications('email')}>Enviar e-mail de teste para mim</button>
      </div>
      <div className="notification-channel">
        <label className="check-row"><span><strong><Icon name="phone" size={16} />Receber resumo por SMS</strong><small>Use seu próprio número para receber o lembrete diário.</small></span><input type="checkbox" name="notificationSmsEnabled" checked={smsEnabled} onChange={event => setSmsEnabled(event.target.checked)} disabled={busy || (!smsConfigured && !smsEnabled)} /></label>
        {!smsConfigured && <p className="notification-channel-note">{notifications.sms?.issue || 'Configuração pendente no servidor.'}</p>}
        <p className="notification-channel-note">SMS utiliza créditos pagos do provedor de envio.</p>
        <label className="field"><span>Meu telefone</span><input name="notificationPhone" type="tel" autoComplete="tel" maxLength={30} placeholder="+55 11 99999-9999" value={phone} onChange={event => setPhone(event.target.value)} disabled={busy} /><small className="hint">Inclua o DDD. Para números brasileiros, use +55 antes do DDD.</small></label>
        <button type="button" className="btn secondary compact" disabled={busy || !smsConfigured || !preferences.smsEnabled || !state.user.phone || dirty} onClick={() => testNotifications('sms')}>Enviar SMS de teste para mim</button>
      </div>
      <div className="notification-daily-time">
        <label className="field"><span>Horário do resumo diário</span><input name="notificationReminderTime" type="time" min="08:00" max="20:59" step={60} required value={reminderTime} onChange={event => setReminderTime(event.target.value)} disabled={busy} /></label>
        <p className="hint">E-mail e SMS enviam um resumo por dia, somente quando você tem atividades pendentes. Escolha entre 08:00 e 20:59, no horário da casa.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="btn full" disabled={busy || !dirty}><Icon name="check" size={16} />Salvar minhas preferências</button>
      {dirty && <p className="hint">Salve as alterações antes de enviar um teste.</p>}
    </form>
    <div className="notification-channel notification-device">
      <div className="notification-device-heading"><Icon name="bell" size={18} /><h4>Avisos neste aparelho</h4><span className={'pill ' + (pushEnabled ? 'notification-ready' : '')}>{pushEnabled ? 'Ativados' : 'Desativados'}</span></div>
      <p className="hint">Receba lembretes mesmo com a agenda fechada. Os avisos se repetem a cada {state.settings.reminderMinutes} minutos enquanto houver tarefas pendentes, durante o dia.</p>
      <p className="hint">No iPhone ou iPad, abra o endereço HTTPS no Safari, use Compartilhar → Adicionar à Tela de Início e abra o app pelo novo ícone.</p>
      {!pushConfigured && <p className="notification-channel-note">Configuração pendente no servidor.</p>}
      {pushUnavailableReason && <p className="notification-channel-note">{pushUnavailableReason} O e-mail pode funcionar mesmo quando o acesso local usa HTTP.</p>}
      {notificationPermission === 'denied' && <p className="notification-channel-note">Os avisos foram bloqueados. Altere a permissão deste site nas configurações do navegador para ativá-los novamente.</p>}
      <div className="notification-device-actions">
        <button type="button" className="btn secondary" disabled={busy || (!pushEnabled && (!pushConfigured || Boolean(pushUnavailableReason) || notificationPermission === 'denied'))} onClick={pushEnabled ? disableNotifications : enableNotifications}><Icon name="bell" size={16} />{pushEnabled ? 'Desativar neste aparelho' : 'Ativar neste aparelho'}</button>
        <button type="button" className="btn secondary compact" disabled={busy || !pushConfigured || !pushEnabled || notificationPermission !== 'granted'} onClick={() => testNotifications('push')}>Enviar teste para este aparelho</button>
      </div>
      <p className="hint">Os botões de teste enviam somente para você. Aguarde um minuto entre testes.</p>
    </div>
    {Boolean(notifications.recent?.length) && <div className="notification-delivery-history"><h4>Meus envios recentes</h4><p className="hint">Aceito pelo serviço confirma o envio ao provedor; a entrega final pode demorar ou falhar.</p><ul>{notifications.recent.slice(0, 4).map((delivery, index) => <li key={delivery.channel + ':' + delivery.createdAt + ':' + index}><span><strong>{channelNames[delivery.channel] || delivery.channel}</strong><small>{deliveryTime(delivery.createdAt)}</small></span><span className={'notification-delivery-status notification-delivery-' + delivery.status}>{statusNames[delivery.status] || 'Aguardando'}</span>{delivery.error && <p>{delivery.error}</p>}</li>)}</ul></div>}
  </section>;
}
