import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Instale o Node.js 24 LTS ou mais recente: https://nodejs.org/pt');
  process.exit(1);
}

let activeChild;
let opening;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    clearTimeout(opening);
    activeChild?.kill(signal);
  });
}

function dependenciesReady() {
  try {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const lockPath = resolve(root, 'package-lock.json');
    const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    return names.every(name => {
      const installed = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8'));
      const locked = lock?.packages?.['node_modules/' + name]?.version;
      return !locked || installed.version === locked;
    });
  } catch {
    return false;
  }
}

function npm(args) {
  return new Promise((resolveRun, rejectRun) => {
    // .cmd precisa do cmd.exe no Windows; os argumentos abaixo são fixos.
    const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
    const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd ' + args.join(' ')] : args;
    const child = spawn(command, commandArgs, { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
    activeChild = child;
    child.on('error', rejectRun);
    child.on('exit', code => code === 0 ? resolveRun() : rejectRun(new Error('npm ' + args.join(' ') + ' encerrou sem concluir.')));
  });
}

function startServer() {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['inherit', 'pipe', 'inherit'],
    windowsHide: true,
  });
  activeChild = child;
  let log = '';
  let opened = false;
  function openBrowser() {
    if (opened) return;
    const setup = log.match(/Configure sua casa: (http:\/\/localhost:\d+\/\?configurar=[a-f0-9]+)/);
    const base = log.match(/Casa em Dia · (http:\/\/localhost:\d+)/);
    const url = setup?.[1] || base?.[1];
    if (!url) return;
    opened = true;
    let command;
    let args;
    if (process.platform === 'win32') {
      command = process.env.ComSpec || 'cmd.exe';
      args = ['/d', '/s', '/c', 'start "" "' + url + '"'];
    } else if (process.platform === 'darwin') {
      command = 'open'; args = [url];
    } else {
      command = 'xdg-open'; args = [url];
    }
    const browser = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true, windowsVerbatimArguments: process.platform === 'win32' });
    browser.on('error', () => console.log('Abra no navegador o endereço mostrado acima.'));
    browser.unref();
  }
  child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    log = (log + chunk.toString()).slice(-16000);
    clearTimeout(opening);
    opening = setTimeout(openBrowser, 300);
  });
  child.on('error', error => {
    console.error('Não foi possível iniciar a casa:', error.message);
    process.exitCode = 1;
  });
  child.on('exit', code => {
    clearTimeout(opening);
    process.exitCode = code || 0;
  });
}

try {
  if (!dependenciesReady()) {
    console.log('Preparando as dependências. A primeira vez precisa de internet.');
    await npm([existsSync(resolve(root, 'package-lock.json')) ? 'ci' : 'install']);
  }
  console.log('Preparando a interface. Aguarde a compilação do Next.js.');
  await npm(['run', 'build']);
  startServer();
} catch (error) {
  console.error('Não foi possível preparar a casa:', error.message);
  console.error('Confira a versão do Node.js e a conexão. Os dados da pasta .data foram preservados.');
  process.exitCode = 1;
}
