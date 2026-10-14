import { useEffect, useState } from 'react';
import { api, suNonAutenticato } from './api.js';
import { sostituisci, usaIndirizzo } from './navigazione.js';
import Login from './Login.jsx';
import PasswordDimenticata from './PasswordDimenticata.jsx';
import Home from './Home.jsx';
import Invito from './Invito.jsx';
import Privacy from './Privacy.jsx';
import AvvisoAggiornamento from './AvvisoAggiornamento.jsx';

// Codice del link di invito, se l'indirizzo è #/invito/<codice>.
const codiceInvito = (hash) => /^#\/invito\/([A-Za-z0-9_-]+)$/.exec(hash)?.[1] ?? null;

export default function App() {
  // undefined = verifica in corso, null = non autenticato
  const [sessione, setSessione] = useState(undefined);
  const indirizzo = usaIndirizzo();
  const invito = codiceInvito(indirizzo);

  useEffect(() => {
    suNonAutenticato(() => setSessione(null));
    api
      .io()
      .then(setSessione)
      .catch(() => setSessione(null));
  }, []);

  // Il cookie è httpOnly: solo il server può chiudere la sessione. Se la
  // richiesta non riesce l'errore risale, invece di fingere l'uscita (su un
  // PC condiviso il prossimo utente si troverebbe dentro).
  async function esci(ovunque = false) {
    await (ovunque ? api.esciOvunque() : api.logout());
    setSessione(null);
  }

  let pagina;
  // Informativa sulla privacy: si apre con o senza accesso.
  if (indirizzo === '#/privacy') pagina = <Privacy />;
  // Il link di invito si apre anche se sul dispositivo c'è già un accesso.
  else if (invito) {
    pagina = (
      <Invito
        codice={invito}
        onAccesso={(s) => {
          sostituisci('#/');
          setSessione(s);
        }}
      />
    );
  } else if (sessione === undefined) pagina = <main className="pagina centrata" aria-busy="true" />;
  else if (!sessione && indirizzo === '#/password-dimenticata') pagina = <PasswordDimenticata />;
  else if (!sessione) pagina = <Login onAccesso={setSessione} />;
  else pagina = <Home sessione={sessione} onEsci={esci} />;

  return (
    <>
      {pagina}
      <AvvisoAggiornamento />
    </>
  );
}
