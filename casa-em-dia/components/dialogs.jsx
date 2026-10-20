'use client';
import { useState } from 'react';
import ActivityIconPicker from './activity-icon-picker';
import ActivityWeekdays from './activity-weekdays';
import ProfilePhotoEditor from './profile-photo-editor';
import NotificationSettings from './notification-settings';
import { useHouse } from '../lib/house-context';
import { formatDate, isDue, swappable, userFor } from '../lib/client.mjs';
import { Avatar, Empty, Icon, Modal } from './ui';

function Input({ label, ...props }) {
  return <label className="field"><span>{label}</span><input {...props}/></label>;
}
function Select({ label, children, ...props }) {
  return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;
}
function DialogForm({ children, onSubmit, submitLabel = 'Salvar', disabled = false, danger = false }) {
  const { busy, closeModal } = useHouse();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (busy || submitting || disabled) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setError(''); setSubmitting(true);
    try { await onSubmit(data, form); }
    catch (failure) { setError(failure.message); }
    finally { setSubmitting(false); }
  }
  return <form className="dialog-form" onSubmit={submit}>
    <fieldset className="dialog-fields" disabled={busy || submitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="btn secondary" onClick={closeModal} disabled={busy || submitting}>Cancelar</button><button type="submit" className={'btn ' + (danger ? 'danger-solid' : '')} disabled={busy || submitting || disabled}>{busy || submitting ? 'Aguarde…' : submitLabel}</button></div>
  </form>;
}

function TaskDialog({ modal }) {
  const { state, now, selected, mutate, closeModal, notify } = useHouse();
  const task = modal.task || {};
  const date = task.due_date || modal.date || selected || now.date;
  const active = state.users.filter(user => user.active);
  return <DialogForm submitLabel={task.id ? 'Salvar atividade' : 'Adicionar atividade'} disabled={!active.length} onSubmit={async data => {
    await mutate('save-task', { ...data, ...(task.id ? { id: task.id } : {}), duration: Number(data.duration) });
    closeModal(); notify('Atividade salva na agenda da casa.');
  }}>
    <Input label="O que precisa ser feito?" name="title" required maxLength={100} defaultValue={task.title || ''}/>
    <ActivityIconPicker activity={{ ...task, area: task.area || 'Cozinha' }}/>
    <div className="form-grid"><Input label="Ambiente" name="area" required maxLength={40} defaultValue={task.area || 'Cozinha'}/><Input label="Duração em minutos" name="duration" type="number" required min={1} max={480} step={1} defaultValue={task.duration || 20}/></div>
    <div className="form-grid"><Input label="Dia" name="due_date" type="date" required min={now.date} defaultValue={date}/><Input label="Concluir até" name="deadline" type="time" required defaultValue={task.deadline || '20:00'}/></div>
    <Select label="Quem vai cuidar?" name="assignee_id" required defaultValue={task.assignee_id || (active.some(user => user.id === state.user.id) ? state.user.id : active[0]?.id)}>{active.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</Select>
    {!active.length && <p role="alert" className="form-error">Cadastre um morador ativo antes de criar atividades.</p>}
    {date < now.date && <p className="hint">Essa atividade ficou no passado. Escolha explicitamente uma nova data para reagendá-la.</p>}
    {task.id && <p className="hint">Salvar cancela eventuais pedidos de troca desta atividade.</p>}
  </DialogForm>;
}

function TemplateDialog({ modal }) {
  const { mutate, closeModal, notify } = useHouse();
  const template = modal.template || {};
  const [weekdays, setWeekdays] = useState(() => template.weekdays || [0, 1, 2, 3, 4, 5, 6]);
  return <DialogForm submitLabel="Salvar atividade" onSubmit={async (data, form) => {
    if (!weekdays.length) throw new Error('Selecione ao menos um dia para a atividade.');
    await mutate('save-template', { ...data, weekdays, ...(template.id ? { id: template.id } : {}), duration: Number(data.duration), active: form.elements.active.checked });
    closeModal(); notify('Atividade recorrente salva para os próximos sorteios.');
  }}>
    <Input label="Nome da atividade" name="title" required maxLength={100} defaultValue={template.title || ''}/>
    <ActivityIconPicker activity={{ ...template, area: template.area || 'Cozinha' }}/>
    <Input label="Ambiente" name="area" required maxLength={40} defaultValue={template.area || 'Cozinha'}/>
    <div className="form-grid"><Input label="Duração em minutos" name="duration" type="number" required min={1} max={480} step={1} defaultValue={template.duration || 20}/><Input label="Concluir até" name="deadline" type="time" required defaultValue={template.deadline || '20:00'}/></div>
    <ActivityWeekdays value={weekdays} onChange={setWeekdays}/>
    <label className="check-row"><span><strong>Entrar nos próximos sorteios</strong><small>Desativar preserva as atividades que já foram agendadas.</small></span><input type="checkbox" name="active" defaultChecked={template.active === undefined || Boolean(template.active)}/></label>
  </DialogForm>;
}

function UserDialog({ modal }) {
  const { state, mutate, closeModal, openModal, notify } = useHouse();
  const user = modal.user || {};
  const self = user.id === state.user.id;
  return <><ProfilePhotoEditor user={user}/><DialogForm submitLabel={user.id ? 'Salvar dados' : 'Cadastrar e criar convite'} onSubmit={async (data, form) => {
    const active = !user.id || self ? true : form.elements.active.checked;
    const result = await mutate('save-user', { name: data.name, email: data.email, phone: data.phone, ...(user.id ? { id: user.id } : {}), active });
    if (result.inviteToken) openModal({ type: 'invite', token: result.inviteToken });
    else { closeModal(); notify('Dados do morador atualizados.'); }
  }}>
    <Input label="Nome" name="name" required maxLength={70} autoComplete="name" defaultValue={user.name || ''}/>
    <Input label="E-mail" name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={user.email || ''}/>
    <Input label="Telefone" name="phone" type="tel" maxLength={30} autoComplete="tel" placeholder="(11) 99999-9999" defaultValue={user.phone || ''}/>
    {user.id && <label className="check-row"><span><strong>Morador ativo</strong><small>{self ? 'Sua própria conta permanece ativa.' : 'Reatribua as tarefas pendentes e pausadas antes de desativar.'}</small></span><input type="checkbox" name={self ? 'selfActive' : 'active'} defaultChecked={Boolean(user.active)} disabled={self}/></label>}
    {(self || !user.id) && <input type="hidden" name="active" value="on"/>}
  </DialogForm></>;
}

function ResetDialog() {
  const { state, mutate, closeModal, notify } = useHouse();
  const [confirmation, setConfirmation] = useState('');
  const completed = state.tasks.filter(task => task.status === 'done').length;
  return <DialogForm submitLabel="Zerar todo o calendário" danger disabled={confirmation !== 'ZERAR CALENDÁRIO'} onSubmit={async () => {
    await mutate('reset-calendar', { confirmation });
    closeModal(); notify('Calendário arquivado e zerado. A geração automática foi desligada; você já pode sortear novamente.');
  }}>
    <div className="danger-notice"><Icon name="alert" size={26}/><div><strong>Esse calendário será arquivado.</strong><p>Serão retiradas da agenda ativa todas as {state.tasks.length} atividades, de todos os meses, incluindo {completed} concluídas e os pedidos de troca. O ranking ativo recomeça do zero.</p></div></div>
    <p>Moradores, contas, atividades recorrentes e os outros combinados da casa permanecem. A geração automática será desligada para o calendário continuar vazio até o novo sorteio.</p>
    <p className="hint">O histórico completo fica guardado no banco e incluído na exportação JSON da Administração. Não existe restauração automática nem importação pelo aplicativo. Depois, use o Sorteador e reative a geração diária quando quiser.</p>
    <Input label="Para confirmar, digite ZERAR CALENDÁRIO" name="confirmation" required autoComplete="off" spellCheck={false} value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="ZERAR CALENDÁRIO"/>
  </DialogForm>;
}

function InviteDialog({ modal }) {
  const { closeModal } = useHouse();
  const [status, setStatus] = useState('');
  const token = modal.token || modal.inviteToken || '';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const link = origin + '/?token=' + encodeURIComponent(token);
  async function copy() {
    try { await navigator.clipboard.writeText(link); setStatus('Link copiado. Envie pessoalmente ao morador.'); }
    catch { setStatus('Selecione o link e copie manualmente pelo teclado ou pelo menu do aparelho.'); }
  }
  return <div className="stack"><div className="security-note"><Icon name="mail" size={22}/><p>Envie esse convite somente à pessoa cadastrada. Ela vai criar a própria senha.</p></div>
    <Input label="Link privado de convite" readOnly value={link} onFocus={event => event.target.select()} onClick={event => event.currentTarget.select()}/>
    <p className="hint">Uso único · válido por 7 dias. Um novo convite invalida o anterior. O aplicativo não envia e-mails automaticamente.</p>
    {origin.includes('localhost') && <p className="hint">Para outra pessoa abrir, gere o link usando o endereço da rede ou o domínio online da casa.</p>}
    {status && <p role="status" className="hint">{status}</p>}
    <div className="modal-actions"><button type="button" className="btn secondary" onClick={closeModal}>Fechar</button><button type="button" className="btn" onClick={copy} disabled={!token}><Icon name="copy" size={16}/>Copiar link</button></div>
  </div>;
}

function SwapDialog({ modal }) {
  const { state, now, mutate, closeModal, notify } = useHouse();
  const locked = new Set(state.swaps.filter(swap => swap.status === 'pending').flatMap(swap => [swap.task_a, swap.task_b]));
  const own = state.tasks.filter(task => task.assignee_id === state.user.id && swappable(task, now) && !locked.has(task.id));
  const [taskA, setTaskA] = useState(modal.task?.id || own[0]?.id || '');
  const source = own.find(task => task.id === taskA);
  const options = source ? state.tasks.filter(task => task.assignee_id !== state.user.id && userFor(state, task.assignee_id).active && swappable(task, now) && !locked.has(task.id) && task.due_date.slice(0, 7) === source.due_date.slice(0, 7)) : [];
  if (!source) return <div className="stack"><Empty title="Sem atividades disponíveis para troca" description="Escolha uma atividade sua, pendente e dentro do prazo. Tarefas com pedido em andamento não podem participar de outra troca."/><button className="btn secondary" onClick={closeModal}>Entendi</button></div>;
  return <DialogForm submitLabel="Enviar pedido" disabled={!options.length} onSubmit={async data => {
    await mutate('swap', { taskA, taskB: data.taskB });
    closeModal(); notify('Pedido enviado. Aguarde o aceite do outro morador.');
  }}>
    <Select label="Minha atividade" name="taskA" value={taskA} onChange={event => setTaskA(event.target.value)}>{own.map(task => <option key={task.id} value={task.id}>{task.title} · {formatDate(task.due_date, { day: '2-digit', month: '2-digit' })}</option>)}</Select>
    <div className="swap-direction"><Icon name="swap" size={25}/></div>
    <Select key={taskA} label="Quero trocar por" name="taskB" required defaultValue=""><option value="" disabled>{options.length ? 'Selecione uma atividade' : 'Nenhuma atividade disponível neste mês'}</option>{options.map(task => <option key={task.id} value={task.id}>{task.title} · {formatDate(task.due_date, { day: '2-digit', month: '2-digit' })} · {userFor(state, task.assignee_id).name}</option>)}</Select>
    <p className="hint">A troca precisa do aceite do outro morador. Apenas atividades do mesmo mês, dentro do prazo e sem pedido pendente aparecem aqui.</p>
  </DialogForm>;
}

function ProfileDialog() {
  const { state, busy, mutate, closeModal, notify, logout } = useHouse();
  return <div className="stack"><ProfilePhotoEditor user={state.user}/><div className="profile-summary row"><Avatar user={state.user}/><div><strong>{state.user.name}</strong><small>{state.user.email}</small></div></div>
    <NotificationSettings/>
    <DialogForm submitLabel="Alterar minha senha" onSubmit={async data => {
      if (data.password !== data.confirmPassword) throw new Error('As novas senhas precisam ser iguais.');
      await mutate('change-password', { currentPassword: data.currentPassword, password: data.password });
      closeModal(); notify('Senha alterada. As sessões anteriores foram encerradas.');
    }}>
      <Input label="Senha atual" name="currentPassword" type="password" required maxLength={128} autoComplete="current-password"/>
      <Input label="Nova senha" name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password"/>
      <Input label="Repita a nova senha" name="confirmPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password"/>
      <p className="hint">Use pelo menos 10 caracteres. A troca encerra seus acessos anteriores em outros aparelhos.</p>
    </DialogForm>
    <button type="button" className="btn secondary full" disabled={busy} onClick={logout}><Icon name="logout" size={16}/>Sair da minha conta</button>
  </div>;
}

function NotificationsDialog() {
  const { state, now, busy, act } = useHouse();
  const tasks = state.tasks.filter(task => task.assignee_id === state.user.id && task.status === 'pending' && task.due_date <= now.date).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.deadline.localeCompare(b.deadline));
  return <div className="stack"><div>{tasks.map(task => <div className="notification-item" key={task.id}><Icon name="bell" size={18}/><div><strong>{task.title}</strong><small>{formatDate(task.due_date)} · até {task.deadline} · {isDue(task, now) ? 'em atraso' : 'pendente'}</small></div><button type="button" className="btn secondary compact" disabled={busy} onClick={() => act('complete', { id: task.id }, 'Atividade concluída. Obrigado por cuidar da casa!')}><Icon name="check" size={14}/>Concluir</button></div>)}{!tasks.length && <Empty title="Você fez sua parte" description="Nenhuma atividade pendente até hoje. A casa agradece!"/>}</div>
    <NotificationSettings/>
  </div>;
}

const definitions = {
  task: ['Um cuidado com a casa', 'Organize uma atividade pontual na agenda.', TaskDialog],
  template: ['Atividade recorrente', 'As mudanças valem para os próximos sorteios. O que já foi agendado mantém seus detalhes.', TemplateDialog],
  user: ['Quem faz a casa', 'Atualize os contatos ou convide mais alguém para cuidar junto.', UserDialog],
  reset: ['Zerar todo o calendário?', 'Leia com atenção antes de recomeçar.', ResetDialog],
  invite: ['Convite pronto para compartilhar', 'Um acesso pessoal para a rotina da casa.', InviteDialog],
  swap: ['Vamos ajustar os planos?', 'Proponha uma troca de atividades entre moradores.', SwapDialog],
  profile: ['Meu perfil', 'Seus dados e seu acesso à casa.', ProfileDialog],
  notifications: ['Um lembrete de cuidado', 'Suas atividades que ainda precisam de atenção.', NotificationsDialog],
};

export default function Dialogs({ modal }) {
  const { busy, closeModal } = useHouse();
  if (!modal || !definitions[modal.type]) return null;
  const [title, description, Content] = definitions[modal.type];
  const recordKey = modal.task?.id || modal.template?.id || modal.user?.id || modal.token || modal.inviteToken || 'new';
  return <Modal title={title} description={description} onClose={busy ? () => {} : closeModal}><Content key={modal.type + ':' + recordKey} modal={modal}/></Modal>;
}
