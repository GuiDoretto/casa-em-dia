import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstallPrompt, INSTALL_DISMISSED_KEY, installDevice } from '../components/install-prompt-state.mjs';

function setup({ userAgent = 'Mozilla/5.0 (Linux; Android 15) Mobile', standalone = false, dismissed = false, blockedStorage = false } = {}) {
  const listeners = new Map(), mediaListeners = new Map(), saved = new Map(dismissed ? [[INSTALL_DISMISSED_KEY, '1']] : []);
  const media = { matches: standalone, addEventListener: (name, callback) => mediaListeners.set(name, callback), removeEventListener: name => mediaListeners.delete(name) };
  const browser = {
    navigator: { userAgent },
    localStorage: { getItem(key) { if (blockedStorage) throw Error('Blocked'); return saved.get(key); }, setItem(key, value) { if (blockedStorage) throw Error('Blocked'); saved.set(key, value); } },
    matchMedia: () => media,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  };
  const updates = [];
  const controller = createInstallPrompt(browser, state => updates.push(state));
  controller.start();
  return { controller, browser, listeners, saved, media, mediaListeners, current: () => updates.at(-1), dispatch: (name, event = {}) => listeners.get(name)?.(event) };
}

test('aviso aparece somente em dispositivos móveis fora do app instalado', () => {
  assert.equal(setup().current().visible, true);
  assert.equal(setup({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }).current().visible, false);
  assert.equal(setup({ standalone: true }).current().visible, false);
  const ipad = installDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 });
  assert.deepEqual(ipad, { ios: true, mobile: true });
  assert.equal(setup({ userAgent: 'Mozilla/5.0 (iPhone)' }).current().mode, 'ios');
});

test('dispensa persiste e funciona mesmo quando o armazenamento está indisponível', () => {
  const app = setup();
  app.controller.dismiss();
  assert.equal(app.current().visible, false);
  assert.equal(app.saved.get(INSTALL_DISMISSED_KEY), '1');
  assert.equal(setup({ dismissed: true }).current().visible, false);
  const blocked = setup({ blockedStorage: true });
  blocked.controller.dismiss();
  assert.equal(blocked.current().visible, false);
});

test('evento nativo exige clique, só pode ser usado uma vez e respeita dispensa', async () => {
  const app = setup();
  let prevented = 0, prompted = 0;
  const event = { preventDefault() { prevented++; }, async prompt() { prompted++; return { outcome: 'accepted' }; } };
  app.dispatch('beforeinstallprompt', event);
  assert.equal(prevented, 1);
  assert.equal(prompted, 0);
  assert.equal(app.current().mode, 'native');
  await app.controller.install();
  assert.equal(prompted, 1);
  assert.equal(app.current().visible, false);
  await app.controller.install();
  app.dispatch('beforeinstallprompt', event);
  assert.equal(prompted, 1);
  assert.equal(prevented, 1);
});

test('recusa da janela nativa dispensa o aviso e aceita API userChoice antiga', async () => {
  const app = setup();
  app.dispatch('beforeinstallprompt', { preventDefault() {}, async prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  await app.controller.install();
  assert.equal(app.current().visible, false);
  assert.equal(app.saved.get(INSTALL_DISMISSED_KEY), '1');
});

test('sem evento nativo ou após erro mostra instruções, sem alegar instalação', async () => {
  const app = setup();
  await app.controller.install();
  assert.equal(app.current().expanded, true);
  assert.equal(app.current().visible, true);
  app.dispatch('beforeinstallprompt', { preventDefault() {}, async prompt() { throw Error('Unavailable'); } });
  await app.controller.install();
  assert.equal(app.current().expanded, true);
  assert.equal(app.current().mode, 'manual');
  assert.ok(app.current().error);
  assert.equal(app.saved.get(INSTALL_DISMISSED_KEY), undefined);
});

test('instalação, mudança para standalone e dispensa em outra aba escondem o aviso', () => {
  const installed = setup();
  installed.dispatch('appinstalled');
  assert.equal(installed.current().visible, false);
  const standalone = setup();
  standalone.media.matches = true;
  standalone.mediaListeners.get('change')();
  assert.equal(standalone.current().visible, false);
  const otherTab = setup();
  otherTab.dispatch('storage', { key: INSTALL_DISMISSED_KEY, newValue: '1' });
  assert.equal(otherTab.current().visible, false);
});

test('desmontagem remove todos os eventos e ignora resultado assíncrono tardio', async () => {
  const app = setup();
  let complete;
  app.dispatch('beforeinstallprompt', { preventDefault() {}, prompt: () => new Promise(resolve => { complete = resolve; }) });
  const installation = app.controller.install();
  const previous = app.current();
  assert.equal(previous.busy, true);
  app.controller.stop();
  complete({ outcome: 'accepted' });
  await installation;
  assert.equal(app.listeners.size, 0);
  assert.equal(app.mediaListeners.size, 0);
  assert.equal(app.current(), previous);
});
