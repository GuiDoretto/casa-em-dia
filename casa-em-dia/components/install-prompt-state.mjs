export const INSTALL_DISMISSED_KEY = 'casa-em-dia:install-dismissed';

export function installDevice(navigator = {}) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return { ios, mobile: ios || navigator.userAgentData?.mobile === true || /Android|Mobile/i.test(navigator.userAgent || '') };
}

// Keeps the one-use browser event outside React rendering and makes the lifecycle testable.
export function createInstallPrompt(browser, onChange) {
  const device = installDevice(browser.navigator);
  const standalone = browser.matchMedia?.('(display-mode: standalone)');
  let installed = standalone?.matches || browser.navigator.standalone === true;
  let dismissed = false, deferred = null, busy = false, expanded = false, error = '', stopped = false;
  try { dismissed = browser.localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'; } catch { }
  const snapshot = () => ({ visible: device.mobile && !installed && !dismissed, mode: deferred ? 'native' : device.ios ? 'ios' : 'manual', busy, expanded, error });
  const emit = () => { if (!stopped) onChange(snapshot()); };
  const persistDismissal = () => {
    dismissed = true;
    try { browser.localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); } catch { }
  };
  const beforeInstall = event => {
    if (!device.mobile || installed || dismissed || typeof event.prompt !== 'function') return;
    event.preventDefault();
    deferred = event;
    error = '';
    emit();
  };
  const appInstalled = () => {
    installed = true;
    deferred = null;
    persistDismissal();
    emit();
  };
  const displayChanged = () => {
    if (standalone?.matches || browser.navigator.standalone === true) appInstalled();
  };
  const storageChanged = event => {
    if (event.key === INSTALL_DISMISSED_KEY && event.newValue === '1') {
      dismissed = true;
      deferred = null;
      emit();
    }
  };
  return {
    start() {
      browser.addEventListener('beforeinstallprompt', beforeInstall);
      browser.addEventListener('appinstalled', appInstalled);
      browser.addEventListener('storage', storageChanged);
      standalone?.addEventListener?.('change', displayChanged);
      emit();
    },
    stop() {
      stopped = true;
      deferred = null;
      browser.removeEventListener('beforeinstallprompt', beforeInstall);
      browser.removeEventListener('appinstalled', appInstalled);
      browser.removeEventListener('storage', storageChanged);
      standalone?.removeEventListener?.('change', displayChanged);
    },
    dismiss() {
      persistDismissal();
      deferred = null;
      emit();
    },
    async install() {
      if (stopped || busy || !snapshot().visible) return;
      if (!deferred) {
        expanded = !expanded;
        emit();
        return;
      }
      // prompt() must be called directly from the user's click, once per event.
      const event = deferred;
      deferred = null;
      busy = true;
      emit();
      try {
        const result = await event.prompt();
        const choice = result?.outcome ? result : await event.userChoice;
        if (choice?.outcome === 'accepted' || choice?.outcome === 'dismissed') persistDismissal();
        else expanded = true;
      } catch {
        expanded = true;
        error = 'Não foi possível abrir a instalação. Use as instruções abaixo.';
      } finally {
        busy = false;
        emit();
      }
    },
  };
}
