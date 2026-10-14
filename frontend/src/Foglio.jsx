import { useEffect, useId, useRef } from 'react';
import { usaChiusuraIndietro } from './navigazione.js';

// Pannello che sale dal fondo dello schermo, sopra la pagina. Si chiude con
// il pulsante ×, con Esc, con il tasto Indietro o con i pulsanti nel piede;
// toccare fuori non lo chiude, per non perdere le modifiche per sbaglio.
// conIndietro={false} per un pannello che è già una pagina (#/bacheca/<id>):
// lì Indietro cambia pagina e il pannello sparisce con lei.
export default function Foglio({ titolo, onChiudi, piede, children, conIndietro = true }) {
  const idTitolo = useId();
  const rif = useRef(onChiudi);
  rif.current = onChiudi;
  usaChiusuraIndietro(onChiudi, conIndietro);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && rif.current();
    document.addEventListener('keydown', esc);
    document.body.classList.add('bloccato');
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.classList.remove('bloccato');
    };
  }, []);

  return (
    <div className="sfondo-foglio">
      <section className="foglio" role="dialog" aria-modal="true" aria-labelledby={idTitolo}>
        <header className="foglio-testa">
          <h2 id={idTitolo}>{titolo}</h2>
          <button type="button" className="chiudi" aria-label="Chiudi" onClick={onChiudi}>
            ×
          </button>
        </header>
        <div className="foglio-corpo">{children}</div>
        {piede && <footer className="foglio-piede">{piede}</footer>}
      </section>
    </div>
  );
}
