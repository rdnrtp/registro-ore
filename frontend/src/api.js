// Chiamate all'API. Il token di sessione viaggia nel cookie httpOnly: il
// codice del browser non lo vede e non lo gestisce.

export class ErroreApi extends Error {
  constructor(messaggio, stato) {
    super(messaggio);
    this.stato = stato;
  }
}

async function chiama(percorso, opzioni = {}) {
  let risposta;
  try {
    risposta = await fetch(`/api${percorso}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...opzioni,
    });
  } catch {
    throw new ErroreApi('Impossibile contattare il server. Controlla la connessione.', 0);
  }
  const dati = await risposta.json().catch(() => ({}));
  // Sessione scaduta o utente disattivato: si torna alla pagina di accesso.
  if (risposta.status === 401 && percorso !== '/auth/login' && !percorso.startsWith('/inviti/')) gestori.nonAutenticato?.();
  if (!risposta.ok) throw new ErroreApi(dati.errore ?? 'Si è verificato un errore', risposta.status);
  return dati;
}

// Nome del file dall'intestazione Content-Disposition (filename* se c'è).
function nomeDaIntestazione(valore) {
  const esteso = /filename\*=UTF-8''([^;]+)/i.exec(valore ?? '');
  if (esteso) return decodeURIComponent(esteso[1]);
  return /filename="([^"]+)"/i.exec(valore ?? '')?.[1];
}

// Scarica un file: { blob, nomeFile }. Gli errori arrivano in JSON come per
// le altre chiamate.
async function scaricaFile(percorso) {
  let risposta;
  try {
    risposta = await fetch(`/api${percorso}`, { credentials: 'same-origin' });
  } catch {
    throw new ErroreApi('Impossibile contattare il server. Controlla la connessione.', 0);
  }
  if (!risposta.ok) {
    const dati = await risposta.json().catch(() => ({}));
    if (risposta.status === 401) gestori.nonAutenticato?.();
    throw new ErroreApi(dati.errore ?? 'Si è verificato un errore', risposta.status);
  }
  return { blob: await risposta.blob(), nomeFile: nomeDaIntestazione(risposta.headers.get('Content-Disposition')) };
}

const gestori = {};

// Chiamata quando una richiesta risponde 401.
export function suNonAutenticato(fn) {
  gestori.nonAutenticato = fn;
}

const json = (metodo, corpo) => ({ method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

export const api = {
  login: (email, password) => chiama('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => chiama('/auth/logout', { method: 'POST' }),
  esciOvunque: () => chiama('/auth/esci-ovunque', { method: 'POST' }),
  io: () => chiama('/auth/me'),
  passwordDimenticata: (email) => chiama('/auth/password-dimenticata', json('POST', { email })),

  attivita: () => chiama('/attivita'),
  mieAttivita: () => chiama('/mie-attivita'),
  salvaMieAttivita: (attivita) => chiama('/mie-attivita', json('PUT', { attivita })),

  mese: (anno, mese) => chiama(`/mese/${anno}/${mese}`),
  salvaGiorno: (data, voci) => chiama(`/giorni/${data}`, json('PUT', { voci })),
  anteprimaPrecompilazione: (anno, mese) => chiama(`/mese/${anno}/${mese}/precompilazione`),
  precompila: (anno, mese) => chiama(`/mese/${anno}/${mese}/precompilazione`, json('POST')),
  anteprimaAnnullaPrecompilazione: (anno, mese) => chiama(`/mese/${anno}/${mese}/annulla-precompilazione`),
  annullaPrecompilazione: (anno, mese) => chiama(`/mese/${anno}/${mese}/annulla-precompilazione`, json('POST')),
  svuotaGiorni: (anno, mese, giorni) => chiama(`/mese/${anno}/${mese}/svuota`, json('POST', { giorni })),
  excelMese: (anno, mese) => scaricaFile(`/mese/${anno}/${mese}/excel`),
  riepilogoInvio: (anno, mese) => chiama(`/mese/${anno}/${mese}/invio`),
  inviaMese: (anno, mese) => chiama(`/mese/${anno}/${mese}/invio`, json('POST')),
  fileInviato: (anno, mese, versione) => scaricaFile(`/mese/${anno}/${mese}/invii/${versione}/file`),

  // Bacheca
  avvisi: () => chiama('/avvisi'),
  avvisiNonLetti: () => chiama('/avvisi/non-letti'),
  avviso: (id) => chiama(`/avvisi/${id}`),
  segnaLetto: (id) => chiama(`/avvisi/${id}/letto`, json('POST')),

  // Notifiche push di questo dispositivo
  statoPush: () => chiama('/push'),
  iscriviPush: (iscrizione) => chiama('/push/iscrizioni', json('POST', iscrizione)),
  disiscriviPush: (endpoint) => chiama('/push/iscrizioni', json('DELETE', { endpoint })),
  provaPush: () => chiama('/push/prova', json('POST')),

  orarioTipo: () => chiama('/orario-tipo'),
  salvaOrarioTipo: (voci) => chiama('/orario-tipo', json('PUT', { voci })),

  aggiungiSedutaPt: (seduta) => chiama('/sedute-pt', json('POST', seduta)),
  modificaSedutaPt: (id, seduta) => chiama(`/sedute-pt/${id}`, json('PUT', seduta)),
  eliminaSedutaPt: (id) => chiama(`/sedute-pt/${id}`, json('DELETE')),

  // Link di invito (pubblici)
  invito: (codice) => chiama(`/inviti/${encodeURIComponent(codice)}`),
  usaInvito: (codice, password) => chiama(`/inviti/${encodeURIComponent(codice)}`, json('POST', { password })),

  // Responsabile e amministratore: mesi degli altri, in sola lettura
  collaboratori: (anno, mese) => chiama(`/collaboratori/${anno}/${mese}`),
  meseDi: (id, anno, mese) => chiama(`/collaboratori/${id}/mese/${anno}/${mese}`),
  excelDi: (id, anno, mese) => scaricaFile(`/collaboratori/${id}/mese/${anno}/${mese}/excel`),
  fileInviatoDi: (id, anno, mese, versione) => scaricaFile(`/collaboratori/${id}/mese/${anno}/${mese}/invii/${versione}/file`),
  riapriMese: (id, anno, mese, motivazione) =>
    chiama(`/collaboratori/${id}/mese/${anno}/${mese}/riapertura`, json('POST', { motivazione })),
  sollecita: (id, anno, mese) => chiama(`/collaboratori/${id}/mese/${anno}/${mese}/sollecito`, json('POST')),

  // Amministratore
  settori: () => chiama('/settori'),
  utenti: () => chiama('/utenti'),
  creaUtente: (dati) => chiama('/utenti', json('POST', dati)),
  modificaUtente: (id, dati) => chiama(`/utenti/${id}`, json('PATCH', dati)),
  nuovoInvito: (id) => chiama(`/utenti/${id}/invito`, json('POST')),
  modificaAttivita: (id, dati) => chiama(`/attivita/${id}`, json('PATCH', dati)),
  ordineAttivita: (ids) => chiama('/ordine-attivita', json('PUT', { attivita: ids })),
  creaSettore: (dati) => chiama('/settori', json('POST', dati)),
  modificaSettore: (id, dati) => chiama(`/settori/${id}`, json('PATCH', dati)),
  eliminaSettore: (id) => chiama(`/settori/${id}`, json('DELETE')),
  organizzazione: () => chiama('/organizzazione'),
  modificaOrganizzazione: (dati) => chiama('/organizzazione', json('PATCH', dati)),
  registroModifiche: (salta = 0) => chiama(`/registro-modifiche?salta=${salta}`),
  email: (salta = 0, stato = '') => chiama(`/email?salta=${salta}${stato ? `&stato=${stato}` : ''}`),
  riprovaEmail: (id) => chiama(`/email/${id}/riprova`, json('POST')),
  avvisiGestione: () => chiama('/avvisi/gestione'),
  pubblicaAvviso: (dati) => chiama('/avvisi', json('POST', dati)),
  modificaAvviso: (id, dati) => chiama(`/avvisi/${id}`, json('PATCH', dati)),
  ritiraAvviso: (id) => chiama(`/avvisi/${id}/ritiro`, json('POST')),
  lettureAvviso: (id) => chiama(`/avvisi/${id}/letture`),
  modelli: () => chiama('/modello'),
  fileModello: () => scaricaFile('/modello/file'),
  // Il file va come corpo della richiesta, non in JSON.
  caricaModello: (file, anteprima) =>
    chiama(`/modello${anteprima ? '?anteprima=1' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Nome-File': encodeURIComponent(file.name) },
      body: file,
    }),
};
