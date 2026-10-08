import { useEffect, useState } from 'react';
import { api, suNonAutenticato } from './api.js';
import Login from './Login.jsx';
import Home from './Home.jsx';
import Invito from './Invito.jsx';
import Privacy from './Privacy.jsx';

// Codice del link di invito, se l'indirizzo è #/invito/<codice>.
const codiceInvito = () => /^#\/invito\/([A-Za-z0-9_-]+)$/.exec(window.location.hash)?.[1] ?? null;
// Informativa sulla privacy: si apre con o senza accesso.
const suPrivacy = () => window.location.hash === '#/privacy';

export default function App() {
  // undefined = verifica in corso, null = non autenticato
  const [sessione, setSessione] = useState(undefined);
  const [invito, setInvito] = useState(codiceInvito);
  const [privacy, setPrivacy] = useState(suPrivacy);

  useEffect(() => {
    suNonAutenticato(() => setSessione(null));
    api
      .io()
      .then(setSessione)
      .catch(() => setSessione(null));
    const cambia = () => {
      setInvito(codiceInvito());
      setPrivacy(suPrivacy());
    };
    window.addEventListener('hashchange', cambia);
    return () => window.removeEventListener('hashchange', cambia);
  }, []);

  // Il cookie è httpOnly: solo il server può chiudere la sessione. Se la
  // richiesta non riesce l'errore risale, invece di fingere l'uscita (su un
  // PC condiviso il prossimo utente si troverebbe dentro).
  async function esci(ovunque = false) {
    await (ovunque ? api.esciOvunque() : api.logout());
    setSessione(null);
  }

  if (privacy) return <Privacy />;
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
