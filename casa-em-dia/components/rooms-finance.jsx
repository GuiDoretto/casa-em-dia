'use client';
import { useState } from 'react';
import { useHouse } from '../lib/house-context';
import { money, calculateBills, billMessage } from '../finances.mjs';
import { Empty, Field, Icon, Modal, Submit } from './ui';
import './rooms-finance.css';

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`;
}
function monthName(month) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T12:00:00Z'));
}
function decimal(cents) { return (Number(cents || 0) / 100).toFixed(2).replace('.', ','); }
function errorText(error) { return error?.message || 'Não foi possível salvar. Tente novamente.'; }
function FormActions({ busy, onClose, children = 'Salvar', danger = false }) {
  return <div className="modal-actions rf-form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Cancelar</button><Submit busy={busy} className={danger ? 'danger-solid' : ''}>{children}</Submit></div>;
}

function RoomForm({ room, onClose }) {
  const { state, busy, mutate, notify } = useHouse();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const taken = new Set((state.rooms || []).filter(item => item.id !== room.id && item.resident_id).map(item => item.resident_id));
  const residents = state.users.filter(user => user.active && !taken.has(user.id));
  const disabled = busy || saving;
  async function save(event) {
    event.preventDefault();
    if (disabled) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setError(''); setSaving(true);
    try {
      await mutate('room-save', { ...values, ...(room.id ? { id: room.id } : {}) });
      notify(room.id ? 'Quarto atualizado.' : 'Quarto cadastrado.');
      onClose();
    } catch (failure) { setError(errorText(failure)); }
    finally { setSaving(false); }
  }
  return <Modal title={room.id ? 'Editar quarto' : 'Cadastrar quarto'} description="Defina o valor mensal e os diferenciais deste quarto." onClose={disabled ? undefined : onClose}>
    <form onSubmit={save} className="rf-form">
      <fieldset disabled={disabled}>
        <Field label="Nome do quarto" name="name" required maxLength={70} defaultValue={room.name || ''} placeholder="Ex.: Quarto 1 — suíte" autoFocus />
        <Field label="Aluguel mensal (R$)" name="rent" required inputMode="decimal" maxLength={18} defaultValue={room.id ? decimal(room.rent_cents) : ''} placeholder="Ex.: 850,00" />
        <Field label="Diferenciais" name="features" as="textarea" rows={3} maxLength={1000} defaultValue={room.features || ''} placeholder="Ex.: banheiro privativo, mobiliado, janela para o jardim" />
        <Field label="Morador do quarto" name="resident_id" defaultValue={room.resident_id || ''}>
          <option value="">Quarto vazio — disponível</option>
          {residents.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
        </Field>
        <p className="hint">Cada quarto recebe um morador ativo. Moradores que já ocupam outro quarto não aparecem nesta lista.</p>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions busy={disabled} onClose={onClose}>{room.id ? 'Salvar quarto' : 'Cadastrar quarto'}</FormActions>
    </form>
  </Modal>;
}

function DeleteDialog({ title, description, action, payload, success, onClose }) {
  const { busy, mutate, notify } = useHouse();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const disabled = busy || saving;
  async function remove(event) {
    event.preventDefault();
    if (disabled) return;
    setError(''); setSaving(true);
    try { await mutate(action, payload); notify(success); onClose(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setSaving(false); }
  }
  return <Modal title={title} description={description} onClose={disabled ? undefined : onClose}><form className="rf-form" onSubmit={remove}>{error && <p className="form-error" role="alert">{error}</p>}<FormActions busy={disabled} onClose={onClose} danger>Excluir</FormActions></form></Modal>;
}

export function Rooms() {
  const { state, isAdmin, busy } = useHouse();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [filter, setFilter] = useState('all');
  const rooms = state.rooms || [];
  const occupied = rooms.filter(room => room.resident_id).length;
  const visible = rooms.filter(room => filter === 'all' || (filter === 'empty' ? !room.resident_id : room.resident_id));
  return <div className="rf-page rf-rooms">
    <div className="rf-overview">
      <div><span className="rf-overview-icon"><Icon name="bed" size={25} /></span><div><p>Quartos da casa</p><strong>{rooms.length}</strong></div></div>
      <div><span className="rf-overview-icon occupied"><Icon name="users" size={25} /></span><div><p>Ocupados</p><strong>{occupied}</strong></div></div>
      <div><span className="rf-overview-icon vacant"><Icon name="home" size={25} /></span><div><p>Disponíveis</p><strong>{rooms.length - occupied}</strong></div></div>
    </div>
    <div className="rf-toolbar"><div className="segmented" role="group" aria-label="Filtrar quartos">{[['all', 'Todos'], ['occupied', 'Ocupados'], ['empty', 'Disponíveis']].map(([value, label]) => <button type="button" key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>{isAdmin && <button type="button" className="btn" disabled={busy} onClick={() => setEditing({})}><Icon name="plus" size={16} />Cadastrar quarto</button>}</div>
    {visible.length ? <div className="rf-room-grid">{visible.map(room => <article className={'panel rf-room-card' + (!room.resident_id ? ' rf-vacant' : '')} key={room.id}>
      <div className="rf-card-heading"><span className="rf-room-icon"><Icon name="bed" size={26} /></span><span className={'pill ' + (room.resident_id ? 'green' : 'amber')}>{room.resident_id ? 'Ocupado' : 'Disponível'}</span></div>
      <h2>{room.name}</h2><p className="rf-features">{room.features || 'Sem diferenciais cadastrados.'}</p>
      <p className="rf-room-price"><strong>{money(room.rent_cents)}</strong><span>/ mês</span></p>
      <div className="rf-room-resident"><Icon name={room.resident_id ? 'users' : 'info'} size={17} /><span>{room.resident_id ? room.resident_name || state.users.find(user => user.id === room.resident_id)?.name || 'Morador' : 'Quarto vazio, procurando morador'}</span></div>
      {isAdmin && <div className="rf-card-actions"><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => setEditing(room)} aria-label={'Editar ' + room.name}><Icon name="edit" size={15} />Editar quarto</button>{!room.resident_id && <button type="button" className="icon-btn" disabled={busy} onClick={() => setDeleting(room)} aria-label={'Excluir ' + room.name}><Icon name="trash" size={17} /></button>}</div>}
    </article>)}</div> : <Empty title={rooms.length ? 'Nenhum quarto neste filtro' : 'Os quartos da casa começam aqui'} description={rooms.length ? 'Selecione outro filtro para ver os demais quartos.' : isAdmin ? 'Cadastre cada quarto, seu valor mensal e os diferenciais para organizar a ocupação e as despesas.' : 'A administração ainda não cadastrou os quartos da casa.'} />}
    {editing && isAdmin && <RoomForm room={editing} onClose={() => setEditing(null)} />}
    {deleting && isAdmin && <DeleteDialog title={'Excluir ' + deleting.name + '?'} description="O quarto será removido do cadastro. Os demonstrativos já gerados serão preservados." action="room-delete" payload={{ id: deleting.id }} success="Quarto excluído." onClose={() => setDeleting(null)} />}
  </div>;
}

function ExpenseForm({ expense, month, onClose }) {
  const { busy, mutate, notify } = useHouse();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const disabled = busy || saving;
  async function save(event) {
    event.preventDefault();
    if (disabled) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setError(''); setSaving(true);
    try {
      await mutate('expense-save', { ...values, month, ...(expense.id ? { id: expense.id } : {}) });
      notify(expense.id ? 'Despesa atualizada.' : 'Despesa adicionada.'); onClose();
    } catch (failure) { setError(errorText(failure)); }
    finally { setSaving(false); }
  }
  return <Modal title={expense.id ? 'Editar despesa comum' : 'Adicionar despesa comum'} description={'Despesas de ' + monthName(month) + ', divididas entre os moradores com quarto.'} onClose={disabled ? undefined : onClose}>
    <form className="rf-form" onSubmit={save}><fieldset disabled={disabled}>
      <Field label="Descrição da despesa" name="description" required maxLength={120} defaultValue={expense.description || ''} placeholder="Ex.: energia, água, internet" autoFocus />
      <Field label="Valor total (R$)" name="amount" required inputMode="decimal" maxLength={18} defaultValue={expense.id ? decimal(expense.amount_cents) : ''} placeholder="Ex.: 180,50" />
      <p className="hint">Informe o valor total da conta. O rateio é calculado automaticamente, somado ao aluguel de cada quarto.</p>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}<FormActions busy={disabled} onClose={onClose}>Salvar despesa</FormActions></form>
  </Modal>;
}

function whatsappUrl(text, phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text);
}

function BillCard({ bill, phone, houseName, isAdmin }) {
  const { notify } = useHouse();
  const [messageOpen, setMessageOpen] = useState(false);
  const message = billMessage(bill, houseName);
  const expenses = Array.isArray(bill.expenses) ? bill.expenses : [];
  const whatsapp = whatsappUrl(message, phone);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) { setMessageOpen(true); return; }
      await navigator.clipboard.writeText(message); notify('Cobrança copiada.');
    } catch { setMessageOpen(true); }
  }
  async function share() {
    if (!navigator.share) { setMessageOpen(true); return; }
    try { await navigator.share({ title: 'Despesas de ' + monthName(bill.month), text: message }); }
    catch (failure) { if (failure.name !== 'AbortError') setMessageOpen(true); }
  }
  return <article className="panel rf-bill-card">
    <header className="rf-card-heading"><div><p className="eyebrow">{monthName(bill.month)}</p><h3>{isAdmin ? bill.resident_name : 'Seu demonstrativo'}</h3><p className="rf-bill-room"><Icon name="bed" size={14} />{bill.room_name}</p></div><span className="pill green">Gerado</span></header>
    <dl className="rf-bill-lines"><div><dt>Aluguel do quarto</dt><dd>{money(bill.rent_cents)}</dd></div><div><dt>Sua parte nas despesas comuns</dt><dd>{money(bill.shared_cents)}</dd></div><div className="rf-bill-total"><dt>Total do mês</dt><dd>{money(bill.total_cents)}</dd></div></dl>
    <details className="rf-bill-details"><summary>Ver despesas que compõem o rateio</summary>{expenses.length ? <ul>{expenses.map((expense, index) => <li key={expense.id || index}><span>{expense.description}</span><strong>{money(expense.amount_cents)}</strong></li>)}</ul> : <p>Não há despesas comuns neste demonstrativo.</p>}<p>Os valores acima são as contas da casa. Sua parte no rateio é {money(bill.shared_cents)}.</p></details>
    <div className="rf-bill-actions"><button type="button" className="btn secondary small-btn" onClick={copy}><Icon name="copy" size={15} />Copiar cobrança</button><a className="btn secondary small-btn" href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label={'Preparar cobrança de ' + bill.resident_name + ' no WhatsApp'}><Icon name="phone" size={15} />WhatsApp</a><button type="button" className="text-btn" onClick={share}><Icon name="arrow" size={14} />Compartilhar</button></div>
    {messageOpen && <Modal title="Compartilhar cobrança" description="Copie a mensagem ou abra o WhatsApp para encaminhar este demonstrativo." onClose={() => setMessageOpen(false)}><div className="rf-form"><Field label="Mensagem da cobrança" as="textarea" readOnly rows={11} value={message} onFocus={event => event.target.select()} /><div className="rf-bill-actions"><button type="button" className="btn secondary" onClick={() => setMessageOpen(false)}>Fechar</button><a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn"><Icon name="phone" size={16} />Abrir WhatsApp</a></div></div></Modal>}
  </article>;
}

function Preview({ rows, totalExpenses }) {
  return <><p className="rf-table-hint">Deslize a tabela para ver todos os valores.</p><div className="rf-preview-scroll"><table className="rf-preview-table"><caption className="rf-sr-only">Prévia da divisão de despesas por morador</caption><thead><tr><th scope="col">Morador / quarto</th><th scope="col">Aluguel</th><th scope="col">Rateio</th><th scope="col">Total</th></tr></thead><tbody>{rows.map(row => <tr key={row.user_id}><th scope="row"><span>{row.resident_name}</span><small>{row.room_name}</small></th><td>{money(row.rent_cents)}</td><td>{money(row.shared_cents)}</td><td><strong>{money(row.total_cents)}</strong></td></tr>)}</tbody><tfoot><tr><th scope="row">Total da casa</th><td>{money(rows.reduce((sum, row) => sum + row.rent_cents, 0))}</td><td>{money(totalExpenses)}</td><td>{money(rows.reduce((sum, row) => sum + row.total_cents, 0))}</td></tr></tfoot></table></div></>;
}

function hasBillChanges(rows, bills, expenses) {
  if (rows.length !== bills.length) return true;
  const expenseKey = items => JSON.stringify(items.map(item => [item.description, Number(item.amount_cents)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const currentExpenses = expenseKey(expenses);
  return rows.some(row => {
    const bill = bills.find(item => item.user_id === row.user_id);
    return !bill || ['resident_name', 'room_name', 'rent_cents', 'shared_cents', 'total_cents'].some(key => row[key] !== bill[key]) || currentExpenses !== expenseKey(Array.isArray(bill.expenses) ? bill.expenses : []);
  });
}

export function Finances() {
  const { state, isAdmin, busy, mutate, notify } = useHouse();
  const [month, setMonth] = useState(currentMonth);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const expenses = isAdmin ? (state.expenses || []).filter(expense => expense.month === month) : [];
  const bills = (state.bills || []).filter(bill => bill.month === month && (isAdmin || bill.user_id === state.user.id));
  const rows = isAdmin ? calculateBills(state.rooms || [], expenses) : [];
  const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount_cents), 0);
  const occupants = new Set((state.rooms || []).map(room => room.resident_id).filter(Boolean));
  const withoutRoom = isAdmin ? state.users.filter(user => user.active && !occupants.has(user.id)) : [];
  const changed = isAdmin && bills.length > 0 && hasBillChanges(rows, bills, expenses);
  const disabled = busy || generating;
  const houseName = state.settings.houseName;
  async function generate() {
    if (disabled || !rows.length) return;
    setError(''); setGenerating(true);
    try { await mutate('bills-generate', { month }); notify('Demonstrativos de ' + monthName(month) + ' gerados.'); }
    catch (failure) { setError(errorText(failure)); }
    finally { setGenerating(false); }
  }
  return <div className="rf-page rf-finances">
    <div className="rf-toolbar rf-finance-toolbar"><div><h2>{isAdmin ? 'Fechamento mensal' : 'Suas despesas mensais'}</h2><p className="hint">{isAdmin ? 'Registre as contas comuns, confira o rateio e prepare cada cobrança.' : 'Consulte seu aluguel e a divisão das contas da casa.'}</p></div><Field label="Mês de referência" name="finance-month" type="month" required min="2000-01" max="2099-12" value={month} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value) && event.target.value >= '2000-01' && event.target.value <= '2099-12') { setMonth(event.target.value); setError(''); } }} disabled={disabled} /></div>
    {isAdmin && <>
      <div className="rf-overview"><div><span className="rf-overview-icon"><Icon name="home" size={24} /></span><div><p>Despesas comuns</p><strong className="rf-money-value">{money(totalExpenses)}</strong></div></div><div><span className="rf-overview-icon occupied"><Icon name="users" size={24} /></span><div><p>Moradores no rateio</p><strong>{rows.length}</strong></div></div><div><span className="rf-overview-icon vacant"><Icon name="calendar" size={24} /></span><div><p>Total previsto</p><strong className="rf-money-value">{money(rows.reduce((sum, row) => sum + row.total_cents, 0))}</strong></div></div></div>
      <section className="panel rf-expenses-panel"><div className="rf-section-heading"><div><h2>Contas da casa</h2><p>Água, energia, internet e outras despesas de {monthName(month)}.</p></div><button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => setEditing({})}><Icon name="plus" size={16} />Adicionar despesa</button></div>
        {expenses.length ? <ul className="rf-expense-list">{expenses.map(expense => <li key={expense.id}><div><strong>{expense.description}</strong><small>Dividida entre {rows.length} {rows.length === 1 ? 'morador' : 'moradores'}</small></div><span>{money(expense.amount_cents)}</span><div className="rf-expense-actions"><button type="button" className="icon-btn" aria-label={'Editar despesa: ' + expense.description} disabled={disabled} onClick={() => setEditing(expense)}><Icon name="edit" size={16} /></button><button type="button" className="icon-btn" aria-label={'Excluir despesa: ' + expense.description} disabled={disabled} onClick={() => setDeleting(expense)}><Icon name="trash" size={16} /></button></div></li>)}</ul> : <p className="rf-no-expenses">Nenhuma despesa comum registrada para este mês. Você pode gerar demonstrativos apenas com o aluguel de cada quarto.</p>}
      </section>
      {withoutRoom.length > 0 && <div className="rf-notice" role="status"><Icon name="alert" size={20} /><p><strong>{withoutRoom.length === 1 ? 'Morador sem quarto:' : 'Moradores sem quarto:'}</strong> {withoutRoom.map(user => user.name).join(', ')}. {withoutRoom.length === 1 ? 'Não participa' : 'Não participam'} deste rateio. Vincule um quarto na tela Quartos para incluir no cálculo.</p></div>}
      <section className="panel rf-preview-panel"><div className="rf-section-heading"><div><h2>Prévia por morador</h2><p>Aluguel de cada quarto + divisão igual das despesas comuns.</p></div><span className="pill">Prévia</span></div>
        {rows.length ? <><Preview rows={rows} totalExpenses={totalExpenses} /><p className="hint rf-rounding-note">Eventuais centavos restantes são distribuídos entre os moradores para que o rateio feche com o total das contas.</p></> : <Empty title="Vincule moradores aos quartos" description="Cadastre um quarto com um morador ativo para calcular e gerar os demonstrativos do mês." />}
        {changed && <div className="rf-notice"><Icon name="info" size={19} /><p>O cálculo atual tem alterações. Atualize os demonstrativos para que as cobranças reflitam esta prévia.</p></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="rf-generate"><p className="hint">Gerar salva a composição de cada cobrança. Para aplicar mudanças nas contas ou nos quartos, gere novamente.</p><button type="button" className="btn" disabled={disabled || !rows.length} aria-busy={generating || undefined} onClick={generate}><Icon name={generating ? 'clock' : 'check'} size={16} />{generating ? 'Gerando…' : bills.length ? 'Atualizar demonstrativos' : 'Gerar demonstrativos'}</button></div>
      </section>
    </>}
    <section className="rf-generated"><div className="rf-section-heading"><div><h2>{isAdmin ? 'Demonstrativos para encaminhar' : 'Seu demonstrativo do mês'}</h2><p>{isAdmin ? 'Cada mensagem inclui somente os valores do respectivo morador. Revise antes de enviar.' : 'Valores do fechamento feito pela administração.'}</p></div>{bills.length > 0 && <span className="pill green">{bills.length} {bills.length === 1 ? 'demonstrativo' : 'demonstrativos'}</span>}</div>
      {bills.length ? <div className="rf-bill-grid">{bills.map(bill => <BillCard key={bill.id || bill.month + bill.user_id} bill={bill} phone={isAdmin ? state.users.find(user => user.id === bill.user_id)?.phone : state.user.phone} houseName={houseName} isAdmin={isAdmin} />)}</div> : <Empty title={isAdmin ? 'Nenhum demonstrativo gerado' : 'Seu demonstrativo ainda não foi gerado'} description={isAdmin ? 'Confira a prévia acima e gere os demonstrativos para copiar ou compartilhar cada cobrança.' : 'A administração ainda não fechou suas despesas de ' + monthName(month) + '. Selecione outro mês para consultar o histórico.'} />}
    </section>
    {editing && isAdmin && <ExpenseForm expense={editing} month={month} onClose={() => setEditing(null)} />}
    {deleting && isAdmin && <DeleteDialog title="Excluir despesa?" description={'A despesa “' + deleting.description + '” será removida de ' + monthName(month) + '. Atualize os demonstrativos para aplicar a mudança às cobranças.'} action="expense-delete" payload={{ id: deleting.id }} success="Despesa excluída." onClose={() => setDeleting(null)} />}
  </div>;
}
