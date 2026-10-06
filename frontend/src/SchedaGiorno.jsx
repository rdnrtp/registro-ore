import { useMemo, useState } from 'react';
import { api } from './api.js';
import { etichettaData, maiuscola, numero } from './date.js';
import EditorQuantita, { MAX_ORE, oreTotali } from './EditorQuantita.jsx';
import Foglio from './Foglio.jsx';

// Scheda di un giorno: aggiunge, modifica o toglie le quantità. Al salvataggio
// invia solo le attività cambiate; una quantità portata a zero viene tolta.
export default function SchedaGiorno({ data, attivita, mie, registrazioni, solaLettura, onSalvato, onChiudi }) {
  const [iniziali] = useState(() => new Map(registrazioni.map((r) => [r.attivita_id, r.quantita])));
  const [valori, setValori] = useState(iniziali);
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);
  const perId = useMemo(() => new Map(attivita.map((a) => [a.id, a])), [attivita]);

  const ore = oreTotali(valori, perId);
  const modificate = [...new Set([...iniziali.keys(), ...valori.keys()])].filter(
    (id) => (valori.get(id) ?? 0) !== (iniziali.get(id) ?? 0),
  );

  function cambia(id, quantita) {
    setValori((v) => new Map(v).set(id, quantita));
    setErrore('');
  }

  async function salva() {
    if (!modificate.length) return onChiudi();
    setInvio(true);
    try {
      await api.salvaGiorno(
        data,
        modificate.map((id) => ({ attivita_id: id, quantita: valori.get(id) ?? 0 })),
      );
      onSalvato();
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
    }
  }

  const troppe = ore > MAX_ORE;
  const piede = (
    <>
      <p className={`totale-giorno${troppe ? ' errore' : ''}`}>
        Totale: <b>{numero(ore)} ore</b>
        {troppe && ` (massimo ${MAX_ORE})`}
      </p>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {solaLettura ? (
        <button type="button" onClick={onChiudi}>
          Chiudi
        </button>
      ) : (
        <div className="pulsanti">
          <button type="button" className="neutro" onClick={onChiudi}>
            Annulla
          </button>
          <button type="button" onClick={salva} disabled={invio || troppe}>
            {invio ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      )}
    </>
  );

  return (
    <Foglio titolo={maiuscola(etichettaData(data))} onChiudi={onChiudi} piede={piede}>
      {solaLettura && <p className="avviso">Il mese è già stato inviato: i dati sono in sola lettura.</p>}
      {!solaLettura && mie.length === 0 && (
        <p className="suggerimento">
          Scegli le attività che fai di solito in <a href="#/attivita">Le mie attività</a>: qui vedrai solo quelle.
        </p>
      )}
      <EditorQuantita attivita={attivita} mie={mie} valori={valori} onCambia={cambia} solaLettura={solaLettura} />
    </Foglio>
  );
}
