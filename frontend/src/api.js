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
  if (!risposta.ok) throw new ErroreApi(dati.errore ?? 'Si è verificato un errore', risposta.status);
  return dati;
}

export const api = {
  login: (email, password) => chiama('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => chiama('/auth/logout', { method: 'POST' }),
  io: () => chiama('/auth/me'),
};
