import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { NOMI_GIORNI, maiuscola, numero } from './date.js';
import EditorQuantita, { MAX_ORE, oreTotali } from './EditorQuantita.jsx';

const SETTIMANA = [1, 2, 3, 4, 5, 6, 7];

// Settimana standard dell'utente: per ogni giorno, attività e quantità. Serve
// a "Precompila il mese" nella vista del mese.
export default function OrarioTipo({ attivita, mie }) {
  // giorno della settimana (1..7) -> Map(id attività -> quantità)
  const [valori, setValori] = useState(null);
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [invio, setInvio] = useState(false);
  const perId = useMemo(() => new Map(attivita.map((a) => [a.id, a])), [attivita]);

  useEffect(() => {
    api
      .orarioTipo()
      .then(({ voci }) => {
        const m = new Map(SETTIMANA.map((g) => [g, new Map()]));
        for (const v of voci) m.get(v.giorno_settimana).set(v.attivita_id, v.quantita);
        setValori(m);
      })
      .catch((err) => setErrore(err.message));
  }, []);

  function cambia(giorno, id, quantita) {
    setValori((v) => new Map(v).set(giorno, new Map(v.get(giorno)).set(id, quantita)));
    setAvviso('');
    setErrore('');
  }

  const troppe = valori && SETTIMANA.some((g) => oreTotali(valori.get(g), perId) > MAX_ORE);

  async function salva() {
    setErrore('');
    setInvio(true);
    try {
      const voci = [];
      for (const [giorno, m] of valori) {
        for (const [id, q] of m) if (q > 0) voci.push({ giorno_settimana: giorno, attivita_id: id, quantita: q });
      }
      await api.salvaOrarioTipo(voci);
      setAvviso('Orario tipo salvato.');
    } catch (err) {
      setErrore(err.message);
    }
    setInvio(false);
  }

  return (
    <div className="contenuto">
      <h1>Orario tipo</h1>
      <p className="dettaglio">
        La tua settimana normale. Con «Precompila il mese» viene copiata nei giorni del mese ancora vuoti; poi correggi
        solo le eccezioni.
      </p>
      {!valori && !errore && <p className="caricamento">Caricamento…</p>}
      {valori &&
        SETTIMANA.map((g) => {
          const ore = oreTotali(valori.get(g), perId);
          return (
            <section key={g} className={`giorno-tipo${g >= 6 ? ' fine-settimana' : ''}`}>
              <h2>
                {maiuscola(NOMI_GIORNI[g - 1])}
                <span className={ore > MAX_ORE ? 'errore' : ''}>{ore ? `${numero(ore)} ore` : 'libero'}</span>
              </h2>
              <EditorQuantita
                attivita={attivita}
                mie={mie}
                valori={valori.get(g)}
                onCambia={(id, q) => cambia(g, id, q)}
              />
            </section>
          );
        })}
      {valori && (
        <div className="barra-salva">
          {troppe && <p className="errore">Un giorno supera le {MAX_ORE} ore.</p>}
          {errore && (
            <p className="errore" role="alert">
              {errore}
            </p>
          )}
          {avviso && (
            <p className="conferma" role="status">
              {avviso}
            </p>
          )}
          <button type="button" onClick={salva} disabled={invio || troppe}>
            {invio ? 'Salvataggio…' : 'Salva orario tipo'}
          </button>
        </div>
      )}
    </div>
  );
}
