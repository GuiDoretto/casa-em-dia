'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client.mjs';
import { Brand, Field, Icon, Submit } from './ui';

function StoryArt() {
  return <svg className="house-art" viewBox="0 0 300 220" fill="none" aria-hidden="true"><ellipse cx="153" cy="204" rx="119" ry="9" fill="#cdddbb" /><path d="m76 103 78-66 79 66v99H76Z" fill="#fcfdf7" stroke="#bccdad" strokeWidth="1.5" /><path d="m61 105 93-79 94 79" stroke="#6d8a58" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /><path d="M98 77V40h18v22" fill="#9eb783" /><rect x="139" y="142" width="34" height="61" rx="4" fill="#9bb381" /><circle cx="165" cy="174" r="2" fill="#eff4e5" /><g fill="#e1ebd4" stroke="#a5ba90"><rect x="95" y="115" width="27" height="31" rx="3" /><rect x="188" y="115" width="27" height="31" rx="3" /><path d="M108 115v31m-13-16h27m79-15v31m-13-16h27" /></g><path d="M250 202v-54m0 30c-23-1-26-18-22-25 18 0 23 17 22 25Zm0-17c20-3 25-20 20-27-16 2-21 18-20 27Z" stroke="#78965e" strokeWidth="2" fill="#b0c98e" /><path d="m235 187 4 19h24l4-19Z" fill="#bfa680" /><path d="M47 201v-35m0 18c-17-3-21-17-16-22 13 1 17 12 16 22Zm0-12c13-3 20-16 15-22-12 1-16 14-15 22Z" fill="#bad29c" stroke="#90aa70" strokeWidth="1.7" /><path d="m35 190 3 16h21l3-16Z" fill="#d4c5a7" /><path d="m255 60 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" fill="#97b575" /><path d="m51 80 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#adc58c" /><circle cx="221" cy="31" r="5" fill="#bfd3a6" /><path d="M141 203h30l16 10h-62Z" fill="#bbcfa5" /></svg>;
}
export default function AuthScreen({ onAuthenticated, notify }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState('login');
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState('');
  const [invite, setInvite] = useState(null);
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const callbacks = useRef({ onAuthenticated, notify });
  callbacks.current = { onAuthenticated, notify };
  useEffect(() => {
    const controller = new AbortController();
    const start = async () => {
      setLoading(true); setError(''); setBootstrapFailed(false);
      const params = new URLSearchParams(window.location.search);
      const setupToken = params.get('configurar');
      const inviteToken = params.get('token');
      try {
        const bootstrap = await api('bootstrap', undefined, {}, controller.signal);
        if (controller.signal.aborted) return;
        setConfigured(bootstrap.configured);
        if (inviteToken) {
          setMode('invite'); setToken(inviteToken);
          const details = await api('invite-info?token=' + encodeURIComponent(inviteToken), undefined, {}, controller.signal);
          if (!controller.signal.aborted) setInvite(details);
        } else if (bootstrap.user) {
          const state = await api('state', undefined, {}, controller.signal);
          if (!controller.signal.aborted) callbacks.current.onAuthenticated(state);
        } else if (!bootstrap.configured && setupToken) {
          setMode('setup'); setToken(setupToken);
        } else {
          setMode(bootstrap.configured ? 'login' : 'unconfigured');
        }
      } catch (failure) {
        if (failure.name === 'AbortError' || controller.signal.aborted) return;
        setError(failure.message || 'Não foi possível conectar ao servidor.');
        setBootstrapFailed(true);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    start();
    return () => controller.abort();
  }, [retry]);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setBusy(true); setError('');
    try {
      let state;
      if (mode === 'setup') state = await api('setup', data, { 'X-Setup-Token': token });
      else if (mode === 'invite') state = await api('accept-invite', { token, password: data.password });
      else state = await api('login', data);
      form.reset();
      callbacks.current.onAuthenticated(state);
    } catch (failure) {
      const message = failure.message || 'Não foi possível entrar. Tente novamente.';
      setError(message); callbacks.current.notify?.(message); setBusy(false);
    }
  }
  const title = mode === 'setup' ? 'A casa começa por aqui.' : mode === 'invite' ? 'Você faz parte da casa.' : 'Bom ter você por aqui.';
  const intro = mode === 'setup' ? 'Crie a casa e seu acesso de administrador. Depois é só convidar a turma.' : mode === 'invite' ? 'Crie sua senha para acompanhar os combinados e fazer sua parte.' : 'Entre para conferir seus cuidados de hoje e os combinados da república.';
  return <main className="auth-shell"><section className="auth-story"><Brand /><div><p className="eyebrow">UMA CASA. MUITOS CUIDADOS.</p><h1>Mais cuidado.<br />Menos cobrança.<br />Mais convivência.</h1><p>Dividir as tarefas é o primeiro passo para compartilhar bons momentos.</p><div className="auth-badges"><span><Icon name="users" size={17} />Divisão justa</span><span><Icon name="leaf" size={17} />Rotina mais leve</span></div></div><StoryArt /><small>O cuidado também é um jeito de morar junto.</small></section><section className="auth-form-wrap"><div className="auth-form panel"><div className="auth-mark"><Icon name={mode === 'setup' ? 'home' : mode === 'invite' ? 'users' : 'leaf'} size={24} /></div>{loading ? <><p className="eyebrow">CASA EM DIA</p><h2>Preparando a casa…</h2><p role="status">Buscando seus combinados com segurança.</p></> : bootstrapFailed ? <><p className="eyebrow">VAMOS TENTAR DE NOVO</p><h2>Não conseguimos conectar.</h2><p role="alert">{error}</p><button className="btn full" type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>{mode === 'invite' && <p className="login-footnote">Se o convite expirou, peça um novo link ao administrador da casa.</p>}</> : mode === 'unconfigured' ? <><p className="eyebrow">BEM-VINDO À CASA EM DIA</p><h2>Vamos abrir a casa?</h2><p>O administrador precisa concluir a primeira configuração antes de todos entrarem.</p><div className="security-note"><Icon name="shield" size={22} /><p>No computador que iniciou o servidor, abra o link privado “Configure sua casa” exibido no terminal. Esse link permite criar o primeiro administrador.</p></div><button type="button" className="btn full" style={{ marginTop: 20 }} onClick={() => setRetry(value => value + 1)}>Já configurei, atualizar</button><p className="login-footnote">Se você é morador, peça seu convite ao administrador.</p></> : <><p className="eyebrow">{mode === 'setup' ? 'PRIMEIRO PASSO' : mode === 'invite' ? 'SEU CONVITE CHEGOU' : 'SEU CANTINHO ORGANIZADO'}</p><h2>{title}</h2><p>{intro}</p>{error && <p role="alert" style={{ color: '#a4473b', marginBottom: 12 }}>{error}</p>}<form onSubmit={submit} aria-busy={busy}>{mode === 'setup' && <><Field label="Nome da casa ou república" name="houseName" required maxLength={70} placeholder="República do Girassol" autoComplete="organization" /><Field label="Seu nome" name="name" required maxLength={70} autoComplete="name" placeholder="Como podemos chamar você?" /></>}{mode === 'invite' ? <><Field label="Seu nome" name="name" value={invite?.name || ''} readOnly autoComplete="name" /><Field label="E-mail do convite" name="email" type="email" value={invite?.email || ''} readOnly autoComplete="username" /></> : <Field label={mode === 'login' ? 'Usuário ou e-mail' : 'Seu e-mail'} name="email" type={mode === 'login' ? 'text' : 'email'} required maxLength={254} autoComplete="username" placeholder={mode === 'login' ? 'admin ou voce@exemplo.com' : 'voce@exemplo.com'} autoCapitalize="none" spellCheck={false} />}{mode === 'setup' && <Field label="Celular (opcional)" name="phone" type="tel" maxLength={30} autoComplete="tel" placeholder="(11) 99999-9999" />}<Field label={mode === 'login' ? 'Sua senha' : 'Crie uma senha'} name="password" type="password" required minLength={mode === 'login' ? undefined : 10} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Digite sua senha' : 'Pelo menos 10 caracteres'} />{mode !== 'login' && <p className="hint">Use de 10 a 128 caracteres. Uma frase longa é fácil de lembrar.</p>}<Submit busy={busy}>{mode === 'setup' ? 'Criar minha casa' : mode === 'invite' ? 'Aceitar convite e entrar' : 'Entrar na casa'}<Icon name="arrow" size={17} /></Submit></form><div className="security-note"><Icon name="shield" size={21} /><p>{mode === 'setup' ? 'Guarde sua senha. Você poderá gerenciar moradores, atividades e os combinados da casa.' : mode === 'invite' ? 'Seu convite é pessoal e só pode ser usado uma vez.' : 'Seu acesso é individual. Cada morador cuida das próprias atividades.'}</p></div><p className="login-footnote">{mode === 'login' ? 'Primeira vez por aqui ou esqueceu sua senha? Peça um convite ao administrador da sua casa.' : 'Compartilhe o cuidado. Sua senha é só sua.'}</p>{mode === 'invite' && configured && <button type="button" className="text-btn" onClick={() => { setMode('login'); setError(''); window.history.replaceState(null, '', window.location.pathname + window.location.hash); }}>Já tenho acesso, entrar com minha senha</button>}</>}</div></section></main>;
}