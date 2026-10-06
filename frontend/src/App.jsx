import { useEffect, useState } from 'react';
import { api, suNonAutenticato } from './api.js';
import Login from './Login.jsx';
import Home from './Home.jsx';

export default function App() {
  // undefined = verifica in corso, null = non autenticato
  const [sessione, setSessione] = useState(undefined);

  useEffect(() => {
    suNonAutenticato(() => setSessione(null));
    api
      .io()
      .then(setSessione)
      .catch(() => setSessione(null));
  }, []);

  async function esci() {
    await api.logout().catch(() => {});
    setSessione(null);
  }

  if (sessione === undefined) return <main className="pagina centrata" aria-busy="true" />;
  if (!sessione) return <Login onAccesso={setSessione} />;
  return <Home sessione={sessione} onEsci={esci} />;
}
