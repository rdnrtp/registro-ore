import { useState } from 'react';
import { api } from './api.js';

// "Password dimenticata?": chi inserisce la propria email riceve un link per
// sceglierne una nuova. Il messaggio è lo stesso che l'email sia registrata o
// no, per non rivelare chi usa l'app.
export default function PasswordDimenticata() {
  const [email, setEmail] = useState('');
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);
  const [fatto, setFatto] = useState(null); // { durata_minuti }

  async function chiedi(evento) {
    evento.preventDefault();
    setErrore('');
    setInvio(true);
    try {
      setFatto(await api.passwordDimenticata(email));
    } catch (err) {
      setErrore(err.message);
    }
    setInvio(false);
  }

  if (fatto) {
    return (
      <main className="pagina centrata">
        <div className="scheda">
          <h1>Controlla la posta</h1>
          <p role="status">
            Se <b>{email.trim()}</b> è l&apos;indirizzo di un account attivo, tra pochi minuti riceverai un&apos;email con un
            link per scegliere una nuova password.
          </p>
          <p className="dettaglio">
            Il link funziona una sola volta e scade dopo {fatto.durata_minuti} minuti. Se non arriva, guarda nello spam; se
            ancora non c&apos;è, chiedi all&apos;amministratore. Finché non usi il link, la password attuale resta valida.
          </p>
          <a className="link-secondario" href="#/">
            Torna alla pagina di accesso
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="pagina centrata">
      <form className="scheda" onSubmit={chiedi}>
        <h1>Password dimenticata</h1>
        <p className="dettaglio">Scrivi l&apos;email con cui accedi: ti mandiamo un link per scegliere una nuova password.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        {errore && (
          <p className="errore" role="alert">
            {errore}
          </p>
        )}
        <button type="submit" disabled={invio}>
          {invio ? 'Invio…' : 'Mandami il link'}
        </button>
        <a className="link-secondario" href="#/">
          Torna alla pagina di accesso
        </a>
      </form>
    </main>
  );
}
