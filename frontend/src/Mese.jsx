import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { NOMI_MESI, etichettaData, maiuscola, meseVicino, numero, oggiIso } from './date.js';
import Foglio from './Foglio.jsx';
import SchedaGiorno from './SchedaGiorno.jsx';
import SedutePt from './SedutePt.jsx';
import { ElencoGiorni, NavigazioneMese, TotaliMese, salvaFile, usaRiepilogo } from './VistaMese.jsx';

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
  const { perGiorno, totali } = usaRiepilogo(dati?.registrazioni, perId);

  const solaLettura = dati?.stato === 'inviato';
  const meseCorrente = dalla(oggi);
  const eMeseCorrente = meseCorrente.anno === anno && meseCorrente.mese === mese;
  const nomeMese = `${NOMI_MESI[mese - 1]} ${anno}`;

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
        <NavigazioneMese
          titolo={maiuscola(nomeMese)}
          onPrecedente={() => vaiA(meseVicino(anno, mese, -1))}
          onSuccessivo={() => vaiA(meseVicino(anno, mese, 1))}
        />
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
          <ElencoGiorni
            anno={anno}
            mese={mese}
            perGiorno={perGiorno}
            perId={perId}
            oggi={oggi}
            rifOggi={rifOggi}
            onApri={setGiornoAperto}
            testoVuotoOggi="Oggi · tocca per inserire"
          />

          <TotaliMese nomeMese={nomeMese} totali={totali} perId={perId} />

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
