'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './ui';
import { createInstallPrompt } from './install-prompt-state.mjs';
import './install-prompt.css';

export function useInstallPrompt() {
  const [state, setState] = useState({ visible: false });
  const prompt = useRef(null);
  useEffect(() => {
    const controller = createInstallPrompt(window, setState);
    prompt.current = controller;
    controller.start();
    // Reuses the existing worker without requesting notification permission.
    if (window.isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { controller.stop(); prompt.current = null; };
  }, []);
  return { state, install: () => prompt.current?.install(), dismiss: () => prompt.current?.dismiss() };
}

export default function InstallPrompt({ installation }) {
  return installation ? <InstallPromptBanner installation={installation} /> : <AutomaticInstallPrompt />;
}

function AutomaticInstallPrompt() {
  const installation = useInstallPrompt();
  return <InstallPromptBanner installation={installation} />;
}

function InstallPromptBanner({ installation }) {
  const { state, install, dismiss } = installation;
  const instructionsId = useId();
  if (!state.visible) return null;
  const native = state.mode === 'native';
  return <section className="install-prompt" aria-label="Instalar Casa em Dia">
    <span className="install-prompt-icon"><Icon name="download" size={23} /></span>
    <div className="install-prompt-content">
      <h2>Quer instalar o Casa em Dia?</h2>
      <p>Adicione à tela de início e abra a rotina da casa com um toque.</p>
      <div className="install-prompt-actions">
        <button type="button" className="btn small-btn" disabled={state.busy} aria-busy={state.busy || undefined} aria-expanded={native ? undefined : state.expanded} aria-controls={native ? undefined : instructionsId} onClick={install}>{state.busy ? 'Abrindo…' : native ? 'Instalar app' : 'Como adicionar'}</button>
        <button type="button" className="text-btn" onClick={dismiss}>Agora não</button>
      </div>
      {state.error && <p className="install-prompt-error" role="status">{state.error}</p>}
      {state.expanded && <div id={instructionsId} className="install-prompt-instructions">
        {state.mode === 'ios' ? <ol>
          <li>No Safari, toque em <strong>Compartilhar</strong>.</li>
          <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
          <li>Toque em <strong>Adicionar</strong> e abra pelo novo ícone.</li>
        </ol> : <>
          <ol>
            <li>Abra o menu do navegador.</li>
            <li>Procure <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>, se disponível.</li>
            <li>Confirme a inclusão e abra pelo novo ícone.</li>
          </ol>
          <p>Se essa opção não aparecer, este navegador pode não oferecer instalação.</p>
        </>}
      </div>}
    </div>
    <button type="button" className="icon-btn install-prompt-close" aria-label="Dispensar sugestão de instalação" onClick={dismiss}><Icon name="close" size={19} /></button>
  </section>;
}
