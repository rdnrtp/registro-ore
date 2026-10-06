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
  if (risposta.status === 401 && percorso !== '/auth/login') gestori.nonAutenticato?.();
  if (!risposta.ok) throw new ErroreApi(dati.errore ?? 'Si è verificato un errore', risposta.status);
  return dati;
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
  io: () => chiama('/auth/me'),

  attivita: () => chiama('/attivita'),
  mieAttivita: () => chiama('/mie-attivita'),
  salvaMieAttivita: (attivita) => chiama('/mie-attivita', json('PUT', { attivita })),

  mese: (anno, mese) => chiama(`/mese/${anno}/${mese}`),
  salvaGiorno: (data, voci) => chiama(`/giorni/${data}`, json('PUT', { voci })),
  anteprimaPrecompilazione: (anno, mese) => chiama(`/mese/${anno}/${mese}/precompilazione`),
  precompila: (anno, mese) => chiama(`/mese/${anno}/${mese}/precompilazione`, json('POST')),

  orarioTipo: () => chiama('/orario-tipo'),
  salvaOrarioTipo: (voci) => chiama('/orario-tipo', json('PUT', { voci })),

  aggiungiSedutaPt: (seduta) => chiama('/sedute-pt', json('POST', seduta)),
  eliminaSedutaPt: (id) => chiama(`/sedute-pt/${id}`, json('DELETE')),
};
