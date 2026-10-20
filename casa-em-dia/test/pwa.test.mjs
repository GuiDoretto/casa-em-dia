import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function setup(clients = []) {
  const handlers = {}, shown = [], opened = [];
  const self = {
    location: { origin: 'https://casa.example.test' },
    addEventListener: (name, callback) => { handlers[name] = callback; },
    skipWaiting() {},
    registration: { showNotification: async (title, options) => { shown.push({ title, ...options }); } },
    clients: { claim: async () => {}, matchAll: async () => clients, openWindow: async url => opened.push(url) },
  };
  runInNewContext(worker, { self, URL });
  return { handlers, shown, opened };
}
test('push sempre mostra aviso visível, inclusive com payload ausente ou inválido', async () => {
  for (const data of [undefined, { json: () => { throw new Error('JSON inválido'); } }, { json: () => null }, { json: () => ({ body: 'Você tem duas tarefas.', url: 'https://fora.example.test' }) }]) {
    const { handlers, shown } = setup();
    let completion;
    handlers.push({ data, waitUntil: promise => { completion = promise; } });
    await completion;
    assert.equal(shown.length, 1);
    assert.equal(shown[0].title, 'Casa em Dia');
    assert.equal(shown[0].tag, 'casa-tarefas');
    assert.ok(shown[0].body.length > 0);
    assert.equal(shown[0].data.view, 'home');
    assert.equal(shown[0].data.url, undefined);
  }
});
test('clique abre somente a agenda e foca uma janela existente da mesma origem', async () => {
  const messages = []; let focused = false, closed = false, completion;
  const client = { url: 'https://casa.example.test/#calendar', focus: async () => { focused = true; }, postMessage: message => messages.push(message) };
  const { handlers, opened } = setup([client]);
  handlers.notificationclick({ notification: { close: () => { closed = true; }, data: { url: 'https://fora.example.test' } }, waitUntil: promise => { completion = promise; } });
  await completion;
  assert.ok(closed); assert.ok(focused);
  assert.equal(messages[0].type, 'OPEN_TASKS');
  assert.equal(opened.length, 0);
  const another = setup([{ url: 'https://fora.example.test/', focus: async () => assert.fail('Não deve focar outro site') }]);
  another.handlers.notificationclick({ notification: { close() {} }, waitUntil: promise => { completion = promise; } });
  await completion;
  assert.equal(another.opened[0], '/#home');
});
test('manifesto e ícones de instalação têm os tamanhos declarados', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/#home');
  assert.equal(manifest.scope, '/');
  for (const [file, dimension] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const png = readFileSync(new URL('../public/icons/' + file, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), dimension);
    assert.equal(png.readUInt32BE(20), dimension);
  }
});
