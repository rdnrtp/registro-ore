import { useState } from 'react';
import { api } from './api.js';

export default function Login({ onAccesso }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);

  async function accedi(evento) {
    evento.preventDefault();
    setErrore('');
    setInvio(true);
    try {
      await api.login(email, password);
      onAccesso(await api.io());
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
    }
  }

  return (
    <main className="pagina centrata">
      <form className="scheda" onSubmit={accedi}>
        <h1>Registro ore</h1>
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
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {errore && (
          <p className="errore" role="alert">
            {errore}
          </p>
        )}
        <button type="submit" disabled={invio}>
          {invio ? 'Accesso in corso…' : 'Accedi'}
        </button>
        <a className="link-secondario" href="#/password-dimenticata">
          Password dimenticata?
        </a>
        <a className="link-privacy" href="#/privacy">
          Informativa sulla privacy
        </a>
      </form>
    </main>
  );
}
