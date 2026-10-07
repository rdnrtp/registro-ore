import { useEffect, useRef, useState } from 'react';

// Pagine scelte dall'ancora dell'indirizzo (#/attivita, #/collaboratori/…):
// il tasto "indietro" del telefono torna alla pagina precedente.

const MESSAGGIO = 'Ci sono modifiche non salvate. Vuoi uscire senza salvarle?';

// Una pagina con modifiche non salvate registra qui una funzione che dice se
// ce ne sono: prima di cambiare pagina si chiede conferma.
let guardia = null;

export function usaGuardiaModifiche(modificato) {
  const rif = useRef(modificato);
  rif.current = modificato;
  useEffect(() => {
    const controlla = () => rif.current;
    guardia = controlla;
    // Chiusura della scheda, ricarica, indirizzo digitato a mano.
    const primaDiUscire = (e) => {
      if (!rif.current) return;
      e.preventDefault();
      e.returnValue = MESSAGGIO;
    };
    window.addEventListener('beforeunload', primaDiUscire);
    return () => {
      if (guardia === controlla) guardia = null;
      window.removeEventListener('beforeunload', primaDiUscire);
    };
  }, []);
}

// true se si può lasciare la pagina: nessuna modifica in sospeso, oppure
// l'utente conferma di volerle perdere.
export const confermaUscita = () => !guardia?.() || window.confirm(MESSAGGIO);

// Parti dell'ancora: '#/collaboratori/2026/10' -> ['collaboratori', '2026', '10'].
const decodifica = (p) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return '';
  }
};
const parti = (hash) => hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodifica);

export function usaRotta() {
  const [hash, setHash] = useState(() => window.location.hash);
  const corrente = useRef(hash);
  useEffect(() => {
    const cambia = () => {
      const nuovo = window.location.hash;
      if (nuovo === corrente.current) return;
      if (!confermaUscita()) {
        // Rimette l'indirizzo della pagina corrente senza ricaricarla.
        window.history.pushState(null, '', corrente.current || '#/');
        return;
      }
      corrente.current = nuovo;
      setHash(nuovo);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', cambia);
    return () => window.removeEventListener('hashchange', cambia);
  }, []);
  return parti(hash);
}
