import { useEffect, useState } from 'react';
import { api } from './api.js';

const MINIMO = 10;

// Pagina del link di invito: il collega sceglie la propria password. Lo
// stesso link serve per reimpostare una password dimenticata.
export default function Invito({ codice, onAccesso }) {
  const [info, setInfo] = useState(null);
  const [erroreLink, setErroreLink] = useState('');
  const [password, setPassword] = useState('');
  const [conferma, setConferma] = useState('');
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    api
      .invito(codice)
      .then(setInfo)
      .catch((err) => setErroreLink(err.message));
  }, [codice]);

  async function salva(evento) {
    evento.preventDefault();
    setErrore('');
    if (password.length < MINIMO) return setErrore(`La password deve avere almeno ${MINIMO} caratteri.`);
    if (password !== conferma) return setErrore('Le due password non coincidono.');
    setInvio(true);
    try {
      await api.usaInvito(codice, password);
      onAccesso(await api.io());
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
    }
  }

  if (erroreLink) {
    return (
      <main className="pagina centrata">
        <div className="scheda">
          <h1>Registro ore</h1>
          <p className="errore" role="alert">
            {erroreLink}
          </p>
          <a href="#/">Vai alla pagina di accesso</a>
        </div>
      </main>
    );
  }
  if (!info) return <main className="pagina centrata" aria-busy="true" />;

  const nuovo = info.scopo === 'nuovo';
  return (
    <main className="pagina centrata">
      <form className="scheda" onSubmit={salva}>
        <h1>{nuovo ? 'Primo accesso' : 'Nuova password'}</h1>
        <p className="dettaglio">
          {info.nome} {info.cognome} · {info.organizzazione}
          <br />
          {nuovo
            ? 'Scegli la password con cui accederai al registro ore. Non la conoscerà nessun altro.'
            : 'Scegli una nuova password. Quella vecchia smetterà di funzionare, anche sugli altri dispositivi.'}
        </p>
        {/* Campo nascosto con l'email: i gestori di password la salvano con la password. */}
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        <label>
          Password (almeno {MINIMO} caratteri)
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={MINIMO}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label>
          Ripeti la password
          <input type="password" autoComplete="new-password" value={conferma} onChange={(e) => setConferma(e.target.value)} required />
        </label>
        {errore && (
          <p className="errore" role="alert">
            {errore}
          </p>
        )}
        <button type="submit" disabled={invio}>
          {invio ? 'Salvataggio…' : 'Salva e accedi'}
        </button>
        <p className="dettaglio">Per accedere userai l&apos;email {info.email}.</p>
      </form>
    </main>
  );
}
