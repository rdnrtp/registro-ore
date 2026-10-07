import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { GIORNI_BREVI, NOMI_MESI, etichettaData, giorniDelMese, maiuscola, meseVicino, numero, oggiIso } from './date.js';
import Foglio from './Foglio.jsx';
import SchedaGiorno from './SchedaGiorno.jsx';
import SedutePt from './SedutePt.jsx';

// Salva sul dispositivo un file ricevuto dall'API (anche da telefono: Safari e
// Chrome rispettano l'attributo download sugli indirizzi blob).
function salvaFile(blob, nomeFile) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeFile;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const dalla = (data) => ({ anno: Number(data.slice(0, 4)), mese: Number(data.slice(5, 7)) });

export default function Mese({ attivita, mie }) {
  const oggi = oggiIso();
  const [periodo, setPeriodo] = useState(() => dalla(oggi));
  const [dati, setDati] = useState(null);
  const [versione, setVersione] = useState(0);
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [giornoAperto, setGiornoAperto] = useState(null);
  const [precompilazione, setPrecompilazione] = useState(null);
  const [scaricando, setScaricando] = useState(false);
  const [avvisoVuoto, setAvvisoVuoto] = useState(false);
  const rifOggi = useRef(null);
  const daPosizionare = useRef(true);
  const { anno, mese } = periodo;

  useEffect(() => {
    let attivo = true;
    api
      .mese(anno, mese)
      .then((d) => {
        if (!attivo) return;
        setDati(d);
        setErrore('');
      })
      .catch((err) => attivo && setErrore(err.message));
    return () => {
      attivo = false;
    };
  }, [anno, mese, versione]);

  // All'apertura la pagina si posiziona su oggi.
  useEffect(() => {
    if (!dati || !daPosizionare.current) return;
    daPosizionare.current = false;
    rifOggi.current?.scrollIntoView({ block: 'center' });
  }, [dati]);

  const ricarica = () => setVersione((v) => v + 1);

  function vaiA(nuovo, suOggi = false) {
    setDati(null);
    setAvviso('');
    setErrore('');
    setPeriodo(nuovo);
    daPosizionare.current = suOggi;
    if (!suOggi) window.scrollTo(0, 0);
  }

  const perId = useMemo(() => new Map(attivita.map((a) => [a.id, a])), [attivita]);
  const giorni = useMemo(() => giorniDelMese(anno, mese), [anno, mese]);

  const { perGiorno, totali } = useMemo(() => {
    const ordine = (id) => perId.get(id)?.ordine ?? 0;
    const perGiorno = new Map();
    const perAttivita = new Map();
    let ore = 0;
    let sedute = 0;
    for (const r of dati?.registrazioni ?? []) {
      if (!perGiorno.has(r.data)) perGiorno.set(r.data, []);
      perGiorno.get(r.data).push(r);
      perAttivita.set(r.attivita_id, (perAttivita.get(r.attivita_id) ?? 0) + r.quantita);
      if (perId.get(r.attivita_id)?.unita === 'sedute') sedute += r.quantita;
      else ore += r.quantita;
    }
    for (const voci of perGiorno.values()) voci.sort((a, b) => ordine(a.attivita_id) - ordine(b.attivita_id));
    const righe = [...perAttivita].sort(([a], [b]) => ordine(a) - ordine(b));
    return { perGiorno, totali: { righe, ore, sedute } };
  }, [dati, perId]);

  const solaLettura = dati?.stato === 'inviato';
  const meseCorrente = dalla(oggi);
  const eMeseCorrente = meseCorrente.anno === anno && meseCorrente.mese === mese;
  const nomeMese = `${NOMI_MESI[mese - 1]} ${anno}`;
  const nomeAttivita = (id) => perId.get(id)?.nome ?? '?';
  const eSedute = (id) => perId.get(id)?.unita === 'sedute';

  async function apriPrecompilazione() {
    setAvviso('');
    try {
      setPrecompilazione(await api.anteprimaPrecompilazione(anno, mese));
    } catch (err) {
      setErrore(err.message);
    }
  }

  async function confermaPrecompilazione() {
    try {
      const { giorni_riempiti: riempiti } = await api.precompila(anno, mese);
      setAvviso(riempiti.length === 1 ? 'Riempito 1 giorno.' : `Riempiti ${riempiti.length} giorni.`);
    } catch (err) {
      setErrore(err.message);
    }
    setPrecompilazione(null);
    ricarica();
  }

  // Un mese senza nessuna registrazione darebbe un file senza ore: prima si chiede conferma.
  async function scaricaExcel(confermato = false) {
    setAvvisoVuoto(false);
    if (!confermato && dati.registrazioni.length === 0) {
      setAvvisoVuoto(true);
      return;
    }
    setAvviso('');
    setErrore('');
    setScaricando(true);
    try {
      const { blob, nomeFile } = await api.excelMese(anno, mese);
      salvaFile(blob, nomeFile ?? `${anno}-${mese}.xlsx`);
    } catch (err) {
      setErrore(err.message);
    } finally {
      setScaricando(false);
    }
  }

  const nGiorni = precompilazione?.giorni.length ?? 0;
  const parolaGiorni = nGiorni === 1 ? 'giorno' : 'giorni';

  return (
    <div className="mese">
      <div className="testata-mese">
        <div className="navigazione-mese">
          <button type="button" className="freccia" aria-label="Mese precedente" onClick={() => vaiA(meseVicino(anno, mese, -1))}>
            ‹
          </button>
          <h1>{maiuscola(nomeMese)}</h1>
          <button type="button" className="freccia" aria-label="Mese successivo" onClick={() => vaiA(meseVicino(anno, mese, 1))}>
            ›
          </button>
        </div>
        <div className="azioni-mese">
          <span className="riassunto">
            {dati && (
              <>
                <b>{numero(totali.ore)}</b> ore
                {totali.sedute > 0 && (
                  <>
                    {' · '}
                    <b>{numero(totali.sedute)}</b> sedute
                  </>
                )}
              </>
            )}
          </span>
          {!eMeseCorrente && (
            <button type="button" className="piccolo neutro" onClick={() => vaiA(meseCorrente, true)}>
              Oggi
            </button>
          )}
          {dati && (
            <button type="button" className="piccolo" onClick={() => scaricaExcel()} disabled={scaricando}>
              {scaricando ? 'Preparo il file…' : 'Scarica Excel'}
            </button>
          )}
          {dati && !solaLettura && (
            <button type="button" className="piccolo" onClick={apriPrecompilazione}>
              Precompila il mese
            </button>
          )}
        </div>
      </div>

      {errore && (
        <p className="errore riquadro" role="alert">
          {errore}
        </p>
      )}
      {avviso && (
        <p className="conferma riquadro" role="status">
          {avviso}
        </p>
      )}
      {solaLettura && <p className="avviso riquadro">Il mese è già stato inviato: i dati sono in sola lettura.</p>}

      {!dati && !errore && <p className="caricamento">Caricamento…</p>}
      {dati && (
        <>
          <ol className="giorni">
            {giorni.map(({ data, giorno, settimana }) => {
              const voci = perGiorno.get(data) ?? [];
              const ore = voci.reduce((t, v) => t + (eSedute(v.attivita_id) ? 0 : v.quantita), 0);
              const classi = ['giorno'];
              if (settimana === 6) classi.push('sabato');
              if (settimana === 7) classi.push('domenica');
              if (data === oggi) classi.push('oggi');
              return (
                <li key={data}>
                  <button
                    type="button"
                    className={classi.join(' ')}
                    ref={data === oggi ? rifOggi : null}
                    aria-current={data === oggi ? 'date' : undefined}
                    onClick={() => setGiornoAperto(data)}
                  >
                    <span className="giorno-data">
                      <span className="giorno-numero">{giorno}</span>
                      <span className="giorno-settimana">{GIORNI_BREVI[settimana - 1]}</span>
                    </span>
                    <span className="giorno-voci">
                      {voci.length ? (
                        voci.map((v) => (
                          <span key={v.attivita_id} className="voce">
                            {nomeAttivita(v.attivita_id)}{' '}
                            <b>
                              {numero(v.quantita)} {eSedute(v.attivita_id) ? 'sed.' : 'h'}
                            </b>
                          </span>
                        ))
                      ) : (
                        <span className="vuoto">{data === oggi ? 'Oggi · tocca per inserire' : '—'}</span>
                      )}
                    </span>
                    {ore > 0 && <span className="giorno-totale">{numero(ore)} h</span>}
                  </button>
                </li>
              );
            })}
          </ol>

          <section className="sezione" aria-labelledby="titolo-totali">
            <h2 id="titolo-totali">Totali di {nomeMese}</h2>
            {totali.righe.length === 0 ? (
              <p className="dettaglio">Nessuna registrazione in questo mese.</p>
            ) : (
              <table className="totali">
                <tbody>
                  {totali.righe.map(([id, q]) => (
                    <tr key={id}>
                      <th scope="row">{nomeAttivita(id)}</th>
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

          <SedutePt
            anno={anno}
            mese={mese}
            oggi={oggi}
            sedute={dati.sedute_pt}
            massimo={dati.max_sedute_pt_per_tipo}
            solaLettura={solaLettura}
            onCambiate={ricarica}
          />
        </>
      )}

      {giornoAperto && dati && (
        <SchedaGiorno
          data={giornoAperto}
          attivita={attivita}
          mie={mie}
          registrazioni={perGiorno.get(giornoAperto) ?? []}
          solaLettura={solaLettura}
          onChiudi={() => setGiornoAperto(null)}
          onSalvato={() => {
            setGiornoAperto(null);
            ricarica();
          }}
        />
      )}

      {avvisoVuoto && dati && (
        <Foglio
          titolo="Mese senza ore"
          onChiudi={() => setAvvisoVuoto(false)}
          piede={
            <div className="pulsanti">
              <button type="button" className="neutro" onClick={() => setAvvisoVuoto(false)}>
                Annulla
              </button>
              <button type="button" onClick={() => scaricaExcel(true)}>
                Scarica comunque
              </button>
            </div>
          }
        >
          <p>
            In {nomeMese} non hai registrato nessuna ora: il file avrà la griglia vuota
            {dati.sedute_pt.length > 0 ? ` e conterrà solo le sedute di personal training (${dati.sedute_pt.length})` : ''}.
          </p>
          <p className="dettaglio">Se è il file da inviare alla segreteria, controlla prima di aver inserito tutte le ore.</p>
        </Foglio>
      )}

      {precompilazione && (
        <Foglio
          titolo="Precompila il mese"
          onChiudi={() => setPrecompilazione(null)}
          piede={
            nGiorni ? (
              <div className="pulsanti">
                <button type="button" className="neutro" onClick={() => setPrecompilazione(null)}>
                  Annulla
                </button>
                <button type="button" onClick={confermaPrecompilazione}>
                  Riempi {nGiorni} {parolaGiorni}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setPrecompilazione(null)}>
                Chiudi
              </button>
            )
          }
        >
          {nGiorni ? (
            <>
              <p>
                L&apos;orario tipo verrà applicato a <b>{nGiorni}</b> {parolaGiorni} di {nomeMese}. I giorni che hanno
                già qualcosa registrato non vengono toccati.
              </p>
              <ul className="elenco-date">
                {precompilazione.giorni.map((d) => (
                  <li key={d}>{etichettaData(d)}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              Non c&apos;è nessun giorno da riempire: i giorni di {nomeMese} sono già compilati, oppure
              l&apos;<a href="#/orario">orario tipo</a> è vuoto.
            </p>
          )}
        </Foglio>
      )}
    </div>
  );
}
