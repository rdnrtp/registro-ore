import { useEffect, useState } from 'react';
import { api, suNonAutenticato } from './api.js';
import Login from './Login.jsx';
import Home from './Home.jsx';
import Invito from './Invito.jsx';

// Codice del link di invito, se l'indirizzo è #/invito/<codice>.
const codiceInvito = () => /^#\/invito\/([A-Za-z0-9_-]+)$/.exec(window.location.hash)?.[1] ?? null;

export default function App() {
  // undefined = verifica in corso, null = non autenticato
  const [sessione, setSessione] = useState(undefined);
  const [invito, setInvito] = useState(codiceInvito);

  useEffect(() => {
    suNonAutenticato(() => setSessione(null));
    api
      .io()
      .then(setSessione)
      .catch(() => setSessione(null));
    const cambia = () => setInvito(codiceInvito());
    window.addEventListener('hashchange', cambia);
    return () => window.removeEventListener('hashchange', cambia);
  }, []);

  async function esci() {
    await api.logout().catch(() => {});
    setSessione(null);
  }

  // Il link di invito si apre anche se sul dispositivo c'è già un accesso.
  if (invito) {
    return (
      <Invito
        codice={invito}
        onAccesso={(s) => {
          window.history.replaceState(null, '', '#/');
          setInvito(null);
          setSessione(s);
        }}
      />
    );
  }
  if (sessione === undefined) return <main className="pagina centrata" aria-busy="true" />;
  if (!sessione) return <Login onAccesso={setSessione} />;
  return <Home sessione={sessione} onEsci={esci} />;
}
