import { useMemo } from 'react';
import { GIORNI_BREVI, giorniDelMese, numero } from './date.js';

// Parti della vista di un mese comuni al proprio mese (Mese.jsx) e ai mesi
// degli altri in sola lettura (MeseCollaboratore.jsx).

// Salva sul dispositivo un file ricevuto dall'API (anche da telefono: Safari e
// Chrome rispettano l'attributo download sugli indirizzi blob).
export function salvaFile(blob, nomeFile) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeFile;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Registrazioni raggruppate per giorno e totali per attività, ore e sedute.
export function usaRiepilogo(registrazioni, perId) {
  return useMemo(() => {
    const ordine = (id) => perId.get(id)?.ordine ?? 0;
    const perGiorno = new Map();
    const perAttivita = new Map();
    let ore = 0;
    let sedute = 0;
    for (const r of registrazioni ?? []) {
      if (!perGiorno.has(r.data)) perGiorno.set(r.data, []);
      perGiorno.get(r.data).push(r);
      perAttivita.set(r.attivita_id, (perAttivita.get(r.attivita_id) ?? 0) + r.quantita);
      if (perId.get(r.attivita_id)?.unita === 'sedute') sedute += r.quantita;
      else ore += r.quantita;
    }
    for (const voci of perGiorno.values()) voci.sort((a, b) => ordine(a.attivita_id) - ordine(b.attivita_id));
    const righe = [...perAttivita].sort(([a], [b]) => ordine(a) - ordine(b));
    return { perGiorno, totali: { righe, ore, sedute } };
  }, [registrazioni, perId]);
}

// Elenco dei giorni del mese con le voci registrate. Senza onApri i giorni
// non si toccano (sola lettura). Con selezionati (Set di date) l'elenco è in
// modalità di selezione: ogni giorno mostra se è scelto.
export function ElencoGiorni({ anno, mese, perGiorno, perId, oggi, rifOggi, onApri, testoVuotoOggi, selezionati }) {
  const giorni = useMemo(() => giorniDelMese(anno, mese), [anno, mese]);
  const eSedute = (id) => perId.get(id)?.unita === 'sedute';
  return (
    <ol className="giorni">
      {giorni.map(({ data, giorno, settimana }) => {
        const voci = perGiorno.get(data) ?? [];
        const ore = voci.reduce((t, v) => t + (eSedute(v.attivita_id) ? 0 : v.quantita), 0);
        const classi = ['giorno'];
        if (settimana === 6) classi.push('sabato');
        if (settimana === 7) classi.push('domenica');
        if (data === oggi) classi.push('oggi');
        if (selezionati?.has(data)) classi.push('selezionato');
        const contenuto = (
          <>
            {selezionati && <span className="spunta" aria-hidden="true">{selezionati.has(data) ? '✓' : ''}</span>}
            <span className="giorno-data">
              <span className="giorno-numero">{giorno}</span>
              <span className="giorno-settimana">{GIORNI_BREVI[settimana - 1]}</span>
            </span>
            <span className="giorno-voci">
              {voci.length ? (
                voci.map((v) => (
                  <span key={v.attivita_id} className="voce">
                    {perId.get(v.attivita_id)?.nome ?? '?'}{' '}
                    <b>
                      {numero(v.quantita)} {eSedute(v.attivita_id) ? 'sed.' : 'h'}
                    </b>
                  </span>
                ))
              ) : (
                <span className="vuoto">{data === oggi && testoVuotoOggi ? testoVuotoOggi : '—'}</span>
              )}
            </span>
            {ore > 0 && <span className="giorno-totale">{numero(ore)} h</span>}
          </>
        );
        const comuni = {
          className: classi.join(' '),
          ref: data === oggi ? rifOggi : null,
          'aria-current': data === oggi ? 'date' : undefined,
        };
        return (
          <li key={data}>
            {onApri ? (
              <button
                type="button"
                {...comuni}
                aria-pressed={selezionati ? selezionati.has(data) : undefined}
                onClick={() => onApri(data)}
              >
                {contenuto}
              </button>
            ) : (
              <div {...comuni}>{contenuto}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function TotaliMese({ nomeMese, totali, perId }) {
  const eSedute = (id) => perId.get(id)?.unita === 'sedute';
  return (
    <section className="sezione" aria-labelledby="titolo-totali">
      <h2 id="titolo-totali">Totali di {nomeMese}</h2>
      {totali.righe.length === 0 ? (
        <p className="dettaglio">Nessuna registrazione in questo mese.</p>
      ) : (
        <table className="totali">
          <tbody>
            {totali.righe.map(([id, q]) => (
              <tr key={id}>
                <th scope="row">{perId.get(id)?.nome ?? '?'}</th>
                <td>
                  {numero(q)} {eSedute(id) ? (q === 1 ? 'seduta' : 'sedute') : 'h'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Totale ore</th>
              <td>{numero(totali.ore)} h</td>
            </tr>
            {totali.sedute > 0 && (
              <tr>
                <th scope="row">
                  Totale sedute <small>(non incluse nelle ore)</small>
                </th>
                <td>{numero(totali.sedute)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      )}
    </section>
  );
}

// Titolo del mese con le frecce per il precedente e il successivo.
export function NavigazioneMese({ titolo, onPrecedente, onSuccessivo }) {
  return (
    <div className="navigazione-mese">
      <button type="button" className="freccia" aria-label="Mese precedente" onClick={onPrecedente}>
        ‹
      </button>
      <h1>{titolo}</h1>
      <button type="button" className="freccia" aria-label="Mese successivo" onClick={onSuccessivo}>
        ›
      </button>
    </div>
  );
}
