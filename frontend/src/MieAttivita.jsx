import { useState } from 'react';
import { api } from './api.js';

// Scelta delle attività che l'utente fa di solito: nella scheda del giorno e
// nell'orario tipo compaiono per prime, le altre restano raggiungibili.
export default function MieAttivita({ attivita, mie, onSalvate }) {
  const [scelte, setScelte] = useState(() => new Set(mie));
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [invio, setInvio] = useState(false);

  function cambia(id) {
    const nuove = new Set(scelte);
    if (nuove.has(id)) nuove.delete(id);
    else nuove.add(id);
    setScelte(nuove);
    setAvviso('');
  }

  async function salva() {
    setErrore('');
    setInvio(true);
    try {
      const { attivita: salvate } = await api.salvaMieAttivita(attivita.filter((a) => scelte.has(a.id)).map((a) => a.id));
      onSalvate(salvate);
      setAvviso('Salvato.');
    } catch (err) {
      setErrore(err.message);
    }
    setInvio(false);
  }

  return (
    <div className="contenuto">
      <h1>Le mie attività</h1>
      <p className="dettaglio">
        Scegli quelle che fai di solito: quando inserisci le ore vedrai solo queste. Le altre restano comunque
        raggiungibili con «Altre attività».
      </p>
      <ul className="scelte-attivita">
        {attivita
          .filter((a) => a.attiva)
          .map((a) => (
            <li key={a.id}>
              <label className={scelte.has(a.id) ? 'scelta-attiva' : ''}>
                <input type="checkbox" checked={scelte.has(a.id)} onChange={() => cambia(a.id)} />
                <span>{a.nome}</span>
                {a.unita === 'sedute' && <small>sedute</small>}
              </label>
            </li>
          ))}
      </ul>
      <div className="barra-salva">
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
        <button type="button" onClick={salva} disabled={invio}>
          {invio ? 'Salvataggio…' : `Salva (${scelte.size} scelte)`}
        </button>
      </div>
    </div>
  );
}
