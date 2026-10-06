import { useState } from 'react';
import { numero } from './date.js';

export const MAX_ORE = 24;

const passoDi = (a) => (a.unita === 'ore' ? 0.5 : 1);

// Ore totali (solo attività a ore) di una mappa id -> quantità.
export function oreTotali(valori, perId) {
  let totale = 0;
  for (const [id, q] of valori) if (perId.get(id)?.unita === 'ore') totale += q;
  return totale;
}

function opzioni(passo) {
  return Array.from({ length: MAX_ORE / passo + 1 }, (_, i) => i * passo);
}

function RigaQuantita({ attivita: a, valore, onCambia, solaLettura }) {
  const passo = passoDi(a);
  const unita = a.unita === 'sedute' ? 'sedute' : 'ore';
  return (
    <li className={`riga-quantita${valore > 0 ? ' con-valore' : ''}`}>
      <span className="riga-nome">
        {a.nome}
        <small>{unita}</small>
      </span>
      <span className="contatore">
        <button
          type="button"
          aria-label={`${a.nome}: togli ${numero(passo)}`}
          disabled={solaLettura || valore <= 0}
          onClick={() => onCambia(a.id, Math.max(0, valore - passo))}
        >
          −
        </button>
        {/* Il valore è anche un menu: sul telefono si sceglie al volo, senza
            premere + sedici volte per otto ore. */}
        <select
          aria-label={`${a.nome}, ${unita}`}
          value={String(valore)}
          disabled={solaLettura}
          onChange={(e) => onCambia(a.id, Number(e.target.value))}
        >
          {opzioni(passo).map((n) => (
            <option key={n} value={String(n)}>
              {numero(n)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={`${a.nome}: aggiungi ${numero(passo)}`}
          disabled={solaLettura || valore >= MAX_ORE}
          onClick={() => onCambia(a.id, Math.min(MAX_ORE, valore + passo))}
        >
          +
        </button>
      </span>
    </li>
  );
}

// Elenco di attività con i contatori. Mostra subito "le mie attività" (tutte,
// se l'utente non ne ha scelte) e quelle che avevano già un valore all'apertura;
// le altre sono dietro un pulsante. L'elenco iniziale non cambia mentre si
// modifica, così le righe non si spostano sotto il dito.
export default function EditorQuantita({ attivita, mie, valori, onCambia, solaLettura = false }) {
  const [inizialmenteUsate] = useState(() => new Set([...valori].filter(([, q]) => q > 0).map(([id]) => id)));
  const [mostraAltre, setMostraAltre] = useState(false);
  const nessunaScelta = mie.length === 0;
  const principale = (a) => inizialmenteUsate.has(a.id) || (a.attiva && (nessunaScelta || mie.includes(a.id)));
  const principali = attivita.filter(principale);
  // Le attività dismesse restano visibili solo se hanno già un valore.
  const altre = attivita.filter((a) => !principale(a) && (a.attiva || (valori.get(a.id) ?? 0) > 0));

  const riga = (a) => (
    <RigaQuantita key={a.id} attivita={a} valore={valori.get(a.id) ?? 0} onCambia={onCambia} solaLettura={solaLettura} />
  );

  return (
    <div className="editor-quantita">
      <ul className="righe-quantita">{principali.map(riga)}</ul>
      {altre.length > 0 && !solaLettura && (
        <>
          <button type="button" className="collegamento" aria-expanded={mostraAltre} onClick={() => setMostraAltre(!mostraAltre)}>
            {mostraAltre ? 'Nascondi le altre attività' : `Altre attività (${altre.length})`}
          </button>
          {mostraAltre && <ul className="righe-quantita">{altre.map(riga)}</ul>}
        </>
      )}
    </div>
  );
}
