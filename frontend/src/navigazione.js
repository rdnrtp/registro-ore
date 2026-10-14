import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

// Pagine scelte dall'ancora dell'indirizzo (#/attivita, #/collaboratori/…) e
// tasto Indietro (telefono, browser, app installata).
//
// La cronologia del browser è tenuta sempre uguale alla "catena" della
// pagina corrente, più una voce per ogni finestra aperta:
//
//   Mese                     #/
//   sezione                  #/  →  #/bacheca
//   pagina in una sezione    #/  →  #/gestione  →  #/gestione/utenti
//   finestra (Foglio)        … più una voce con lo stesso indirizzo
//
// Così Indietro chiude la finestra aperta; altrimenti risale di un livello
// (pagina interna → sezione → Mese); sul Mese non resta niente e si esce
// dall'app (o dalla pagina, nel browser). Cambiare sezione dalla barra in
// basso sostituisce la voce invece di aggiungerne: non si accumulano pagine.
//
// Ogni collegamento interno (<a href="#/…">) passa da naviga(); le voci
// create dall'app hanno history.state.ro.

const MESSAGGIO = 'Ci sono modifiche non salvate. Vuoi uscire senza salvarle?';

// Una pagina con modifiche non salvate registra qui una funzione che dice se
// ce ne sono: prima di cambiare pagina si chiede conferma.
let guardia = null;

export function usaGuardiaModifiche(modificato) {
  const rif = useRef(modificato);
  rif.current = modificato;
  useEffect(() => {
    const controlla = () => rif.current;
    guardia = controlla;
    // Chiusura della scheda, ricarica, indirizzo digitato a mano.
    const primaDiUscire = (e) => {
      if (!rif.current) return;
      e.preventDefault();
      e.returnValue = MESSAGGIO;
    };
    window.addEventListener('beforeunload', primaDiUscire);
    return () => {
      if (guardia === controlla) guardia = null;
      window.removeEventListener('beforeunload', primaDiUscire);
    };
  }, []);
}

// true se si può lasciare la pagina: nessuna modifica in sospeso, oppure
// l'utente conferma di volerle perdere.
export const confermaUscita = () => !guardia?.() || window.confirm(MESSAGGIO);

// true se ci sono modifiche non salvate (senza chiedere nulla).
export const modificheInSospeso = () => Boolean(guardia?.());

// Parti dell'ancora: '#/collaboratori/2026/10' -> ['collaboratori', '2026', '10'].
const decodifica = (p) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return '';
  }
};
const parti = (hash) => hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodifica);
const norma = (hash) => (!hash || hash === '#' ? '#/' : hash);
const UUID = /^[0-9a-f-]{36}$/i;

// Pagine su cui risale Indietro, dalla più bassa (il Mese) a quella indicata.
export function catena(hash) {
  const p = parti(hash);
  if (p.length === 0) return ['#/'];
  // Il link di invito è una pagina a sé: dopo l'accesso lascia il posto al Mese.
  if (p[0] === 'invito') return [hash];
  if (p[0] === 'collaboratori' && UUID.test(p[1] ?? '')) {
    return ['#/', p[2] && p[3] ? `#/collaboratori/${p[2]}/${p[3]}` : '#/collaboratori', hash];
  }
  if ((p[0] === 'gestione' || p[0] === 'bacheca') && p.length > 1) return ['#/', `#/${p[0]}`, hash];
  return ['#/', hash];
}

// ---------------------------------------------------------------- stato

const STATO = { ro: 1 };
let corrente = norma(window.location.hash);
const ascoltatori = new Set();

function annuncia(hash) {
  if (hash === corrente) return;
  corrente = hash;
  window.scrollTo(0, 0);
  for (const fn of ascoltatori) fn();
}

const iscrivi = (fn) => {
  ascoltatori.add(fn);
  return () => ascoltatori.delete(fn);
};

// Ancora corrente ('#/…'), aggiornata a ogni cambio di pagina.
export const usaIndirizzo = () => useSyncExternalStore(iscrivi, () => corrente);

// Parti dell'ancora corrente: ['collaboratori', '2026', '10'].
export function usaRotta() {
  const hash = usaIndirizzo();
  return useMemo(() => parti(hash), [hash]);
}

// Le operazioni sulla cronologia vanno in fila: history.go() è asincrono e
// una push fatta prima che finisca finirebbe nel posto sbagliato.
let coda = Promise.resolve();
const inCoda = (op) => {
  coda = coda.then(op).catch((err) => console.error(err));
  return coda;
};

// Risposta all'history.go() fatto dall'app (non dall'utente).
let fineSalto = null;

function salta(n) {
  if (n <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    // Se il browser non può tornare indietro di n voci il popstate non
    // arriva: dopo un secondo si va avanti comunque.
    const timer = setTimeout(() => {
      fineSalto = null;
      resolve();
    }, 1000);
    fineSalto = () => {
      clearTimeout(timer);
      fineSalto = null;
      resolve();
    };
    window.history.go(-n);
  });
}

// Finestre aperte (Foglio, selezione dei giorni), dalla più vecchia.
const finestre = [];
let ultimaFinestra = 0;
export const finestreAperte = () => finestre.length > 0;

// Va alla pagina indicata ('#/…') rimettendo la cronologia nella forma
// descritta in cima. Chiede conferma se ci sono modifiche non salvate.
export function naviga(destinazione, { senzaConferma = false } = {}) {
  if (!senzaConferma && norma(destinazione) !== corrente && !confermaUscita()) return Promise.resolve();
  return inCoda(async () => {
    const arrivo = norma(destinazione);
    const C = catena(corrente);
    const T = catena(arrivo);
    // Le voci delle finestre aperte stanno sopra la pagina: si tolgono anche
    // quelle. Le finestre si chiudono da sole con la pagina che le contiene.
    const sopra = finestre.filter((f) => f.spinta).length;
    for (const f of finestre) f.staccata = true;
    let k = 0;
    while (k < C.length && k < T.length && C[k] === T[k]) k++;
    const daTogliere = C.length - k + sopra;
    const daAggiungere = T.slice(k);
    if (daAggiungere.length === 0) {
      await salta(daTogliere);
      // Nel caso la voce trovata non sia quella attesa.
      if (norma(window.location.hash) !== arrivo) window.history.replaceState(STATO, '', arrivo);
    } else if (daTogliere === 0) {
      for (const h of daAggiungere) window.history.pushState(STATO, '', h);
    } else {
      await salta(daTogliere - 1);
      window.history.replaceState(STATO, '', daAggiungere[0]);
      for (const h of daAggiungere.slice(1)) window.history.pushState(STATO, '', h);
    }
    annuncia(arrivo);
  });
}

// Sostituisce la pagina corrente senza lasciare traccia (es. dopo il link di invito).
export function sostituisci(destinazione) {
  return inCoda(() => {
    const arrivo = norma(destinazione);
    window.history.replaceState(STATO, '', arrivo);
    annuncia(arrivo);
  });
}

// Finestra che si chiude con Indietro: finché il componente che la usa è
// montato, la cronologia ha una voce in più; Indietro la toglie e chiama
// chiudi(). Se la finestra si chiude in un altro modo (×, Annulla, Salva) la
// voce viene tolta, così non serve premere Indietro a vuoto.
export function usaChiusuraIndietro(chiudi, attiva = true) {
  const rif = useRef(chiudi);
  rif.current = chiudi;
  useEffect(() => {
    if (!attiva) return undefined;
    ultimaFinestra += 1;
    const finestra = { id: ultimaFinestra, chiudi: () => rif.current(), spinta: false, chiusaDaIndietro: false, staccata: false };
    finestre.push(finestra);
    inCoda(() => {
      if (!finestre.includes(finestra) || finestra.staccata) return;
      window.history.pushState({ ...STATO, finestra: finestra.id }, '', corrente);
      finestra.spinta = true;
    });
    return () => {
      const i = finestre.indexOf(finestra);
      if (i >= 0) finestre.splice(i, 1);
      if (finestra.chiusaDaIndietro || finestra.staccata) return;
      inCoda(async () => {
        if (finestra.spinta && window.history.state?.finestra === finestra.id) await salta(1);
      });
    };
  }, [attiva]);
}

// Lo stesso, come componente: <ChiusuraIndietro onChiudi={…} />.
export function ChiusuraIndietro({ onChiudi }) {
  usaChiusuraIndietro(onChiudi);
  return null;
}

// Indietro/avanti dell'utente (o indirizzo cambiato a mano).
function suIndietro() {
  if (fineSalto) {
    fineSalto();
    return;
  }
  const finestra = finestre.at(-1);
  if (finestra && finestra.spinta && !finestra.staccata) {
    finestre.pop();
    finestra.chiusaDaIndietro = true;
    finestra.chiudi();
    return;
  }
  const arrivo = norma(window.location.hash);
  if (arrivo === corrente) return;
  if (!confermaUscita()) {
    // Rimette la pagina corrente senza ricaricarla.
    window.history.pushState(STATO, '', corrente);
    return;
  }
  annuncia(arrivo);
}

// Collegamenti interni: <a href="#/…"> passa da naviga(). Con un tasto
// modificatore o target="_blank" il browser fa da sé (nuova scheda).
function suClic(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target.closest?.('a[href^="#/"]');
  if (!link || link.target === '_blank') return;
  e.preventDefault();
  naviga(link.getAttribute('href'));
}

// All'apertura: se la cronologia non è dell'app (primo caricamento, link da
// un'email) la si costruisce, così Indietro risale fino al Mese. Dopo una
// ricarica la cronologia c'è già e si lascia com'è.
export function avviaNavigazione() {
  const stato = window.history.state;
  if (!stato?.ro) {
    const T = catena(corrente);
    window.history.replaceState(STATO, '', T[0]);
    for (const h of T.slice(1)) window.history.pushState(STATO, '', h);
  } else if (stato.finestra) {
    // Ricarica con una finestra aperta: la finestra non c'è più.
    window.history.replaceState(STATO, '', corrente);
  }
  window.addEventListener('popstate', suIndietro);
  window.addEventListener('hashchange', suIndietro);
  document.addEventListener('click', suClic);
}
