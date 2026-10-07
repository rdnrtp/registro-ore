import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { NOMI_GIORNI, maiuscola, numero } from './date.js';
import EditorQuantita, { MAX_ORE, oreTotali } from './EditorQuantita.jsx';
import { usaGuardiaModifiche } from './navigazione.js';

const SETTIMANA = [1, 2, 3, 4, 5, 6, 7];

// Voci con quantità, in forma confrontabile: serve a capire se ci sono
// modifiche non salvate.
function voci(valori) {
  const elenco = [];
  for (const [giorno, m] of valori) {
    for (const [id, q] of m) if (q > 0) elenco.push({ giorno_settimana: giorno, attivita_id: id, quantita: q });
  }
  return elenco;
}
const impronta = (valori) =>
  JSON.stringify(voci(valori).map((v) => `${v.giorno_settimana}|${v.attivita_id}|${v.quantita}`).sort());

// Settimana standard dell'utente: per ogni giorno, attività e quantità. Serve
// a "Precompila il mese" nella vista del mese.
export default function OrarioTipo({ attivita, mie }) {
  // giorno della settimana (1..7) -> Map(id attività -> quantità)
  const [valori, setValori] = useState(null);
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [invio, setInvio] = useState(false);
  const [salvato, setSalvato] = useState(null);
  const modificato = valori !== null && impronta(valori) !== salvato;
  // Uscendo dalla pagina con modifiche non salvate si chiede conferma.
  usaGuardiaModifiche(modificato);
  const perId = useMemo(() => new Map(attivita.map((a) => [a.id, a])), [attivita]);

  useEffect(() => {
    api
      .orarioTipo()
      .then(({ voci: lette }) => {
        const m = new Map(SETTIMANA.map((g) => [g, new Map()]));
        for (const v of lette) m.get(v.giorno_settimana).set(v.attivita_id, v.quantita);
        setValori(m);
        setSalvato(impronta(m));
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
      await api.salvaOrarioTipo(voci(valori));
      setSalvato(impronta(valori));
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
          {modificato && !avviso && <p className="avviso">Modifiche non salvate.</p>}
          <button type="button" onClick={salva} disabled={invio || troppe || !modificato}>
            {invio ? 'Salvataggio…' : 'Salva orario tipo'}
          </button>
        </div>
      )}
    </div>
  );
}
