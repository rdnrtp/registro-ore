import { api } from './api.js';

// Notifiche push sul dispositivo che si sta usando (pagina Notifiche.jsx).
// Il browser tiene l'iscrizione (PushSubscription) e la chiede al servizio
// push del suo produttore; il server la registra legata alla sessione, così
// "Esci" la cancella. In localStorage resta l'id dell'utente che le ha
// attivate qui: dopo un nuovo accesso dello stesso utente (sessione scaduta)
// l'iscrizione si rinnova da sola, per un altro utente no.

const MARCA = 'registro-ore:push-utente';

const leggiMarca = () => {
  try {
    return localStorage.getItem(MARCA);
  } catch {
    return null;
  }
};
const scriviMarca = (valore) => {
  try {
    if (valore) localStorage.setItem(MARCA, valore);
    else localStorage.removeItem(MARCA);
  } catch {
    // Archivio non disponibile (navigazione privata): pazienza.
  }
};

const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installata = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// 'si' | 'ios-da-installare' (iPhone/iPad: solo con l'app sulla schermata
// Home) | 'non-supportate'.
export function supporto() {
  if (ios() && !installata()) return 'ios-da-installare';
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'non-supportate';
  }
  return 'si';
}

// Il service worker si registra solo nella versione compilata in HTTPS
// (main.jsx): altrove le push non sono possibili.
async function registrazione() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg?.active) return reg;
  return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
}

const daBase64url = (testo) => {
  const b = atob(testo.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (testo.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

const stessaChiave = (iscrizione, chiave) => {
  const usata = iscrizione.options?.applicationServerKey;
  if (!usata) return true;
  const a = new Uint8Array(usata);
  const b = daBase64url(chiave);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

async function iscrizioneDelBrowser() {
  if (supporto() !== 'si') return null;
  const reg = await registrazione();
  return reg ? reg.pushManager.getSubscription() : null;
}

// true se su questo dispositivo le push sono attive per l'utente indicato.
export async function attiveQui(utenteId) {
  if (supporto() !== 'si' || Notification.permission !== 'granted' || leggiMarca() !== utenteId) return false;
  return Boolean(await iscrizioneDelBrowser());
}

// Da chiamare dopo un tocco su "Attiva notifiche" (mai da sola: il browser
// chiede il permesso). Restituisce { permesso, dispositivi? }.
export async function attiva(chiavePubblica, utenteId) {
  const permesso = await Notification.requestPermission();
  if (permesso !== 'granted') return { permesso };
  const reg = await registrazione();
  if (!reg) throw new Error('Le notifiche non sono disponibili in questa versione dell\'app.');
  let iscrizione = await reg.pushManager.getSubscription();
  // Iscrizione fatta con un'altra chiave del server: si rifà.
  if (iscrizione && !stessaChiave(iscrizione, chiavePubblica)) {
    await iscrizione.unsubscribe();
    iscrizione = null;
  }
  iscrizione ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: daBase64url(chiavePubblica) });
  const { dispositivi } = await api.iscriviPush(iscrizione.toJSON());
  scriviMarca(utenteId);
  return { permesso, dispositivi };
}

// Disattiva su questo dispositivo. Restituisce { dispositivi } rimasti.
export async function disattiva() {
  const iscrizione = await iscrizioneDelBrowser();
  const r = iscrizione ? await api.disiscriviPush(iscrizione.endpoint) : await api.statoPush();
  await iscrizione?.unsubscribe();
  scriviMarca(null);
  return { dispositivi: r.dispositivi };
}

// All'apertura dell'app: se l'utente le aveva attivate qui, rinnova
// l'iscrizione sul server (dopo un nuovo accesso la vecchia sessione e la
// sua iscrizione non ci sono più). Non chiede mai permessi.
export async function rinnova(utenteId) {
  try {
    if (!(await attiveQui(utenteId))) return;
    const iscrizione = await iscrizioneDelBrowser();
    if (iscrizione) await api.iscriviPush(iscrizione.toJSON());
  } catch {
    // Si riprova alla prossima apertura.
  }
}

// Uscita da questo dispositivo: il server ha già cancellato l'iscrizione con
// la sessione; si toglie anche quella del browser.
export async function dimentica() {
  scriviMarca(null);
  try {
    await (await iscrizioneDelBrowser())?.unsubscribe();
  } catch {
    // Niente da fare: il server non la conosce più comunque.
  }
}
