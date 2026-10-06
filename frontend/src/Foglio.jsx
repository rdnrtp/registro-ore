import { useEffect, useId } from 'react';

// Pannello che sale dal fondo dello schermo, sopra la pagina. Si chiude con
// il pulsante ×, con Esc o con i pulsanti nel piede; toccare fuori non lo
// chiude, per non perdere le modifiche per sbaglio.
export default function Foglio({ titolo, onChiudi, piede, children }) {
  const idTitolo = useId();

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onChiudi();
    document.addEventListener('keydown', esc);
    document.body.classList.add('bloccato');
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.classList.remove('bloccato');
    };
  }, [onChiudi]);

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
