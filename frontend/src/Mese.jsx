import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { NOMI_MESI, etichettaData, maiuscola, meseVicino, numero, oggiIso } from './date.js';
import Foglio from './Foglio.jsx';
import SchedaGiorno from './SchedaGiorno.jsx';
import SedutePt from './SedutePt.jsx';
import StatoInvio from './StatoInvio.jsx';
import { dataOra } from './GestioneUtenti.jsx';
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
  const [invio, setInvio] = useState(null); // riepilogo prima dell'invio
  const [inviando, setInviando] = useState(false);
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

  async function apriInvio() {
    setAvviso('');
    setErrore('');
    try {
      setInvio(await api.riepilogoInvio(anno, mese));
    } catch (err) {
      setErrore(err.message);
    }
  }

  async function confermaInvio() {
    setInviando(true);
    try {
      await api.inviaMese(anno, mese);
      setAvviso(`Mese inviato. L'email con il file parte tra pochi secondi: lo stato è qui sotto.`);
    } catch (err) {
      setErrore(err.message);
    }
    setInviando(false);
    setInvio(null);
    ricarica();
  }

  async function scaricaVersione(versione) {
    setErrore('');
    try {
      const { blob, nomeFile } = await api.fileInviato(anno, mese, versione);
      salvaFile(blob, nomeFile ?? `${anno}-${mese}.xlsx`);
    } catch (err) {
      setErrore(err.message);
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
                {solaLettura && <span className="etichetta inviato">inviato il {dataOra(dati.invii[0]?.inviato_il ?? Date.now())}</span>}
                {!solaLettura && dati.invii.length > 0 && <span className="etichetta riaperto">riaperto: da inviare di nuovo</span>}
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
          {dati && !solaLettura && (
            <button type="button" className="piccolo invia" onClick={apriInvio}>
              {dati.invii.length ? 'Invia di nuovo' : 'Invia il mese'}
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
      {solaLettura && (
        <p className="avviso riquadro">
          Il mese è stato inviato: i dati sono in sola lettura. Per una correzione chiedi all&apos;amministratore di riaprirlo.
        </p>
      )}

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

          <StatoInvio stato={dati.stato} invii={dati.invii} io onScarica={scaricaVersione} />

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

      {invio && (
        <RiepilogoInvio
          invio={invio}
          nomeMese={nomeMese}
          inviando={inviando}
          onChiudi={() => setInvio(null)}
          onConferma={confermaInvio}
        />
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

// Riepilogo prima dell'invio: cosa parte e a chi. Gli avvisi (mese non finito,
// mese vuoto) non impediscono di inviare.
function RiepilogoInvio({ invio, nomeMese, inviando, onChiudi, onConferma }) {
  const { totali, avvisi } = invio;
  return (
    <Foglio
      titolo={invio.sostituisce ? 'Invia di nuovo il mese' : 'Invia il mese'}
      onChiudi={onChiudi}
      piede={
        <div className="pulsanti">
          <button type="button" className="neutro" onClick={onChiudi}>
            Annulla
          </button>
          <button type="button" onClick={onConferma} disabled={inviando || !invio.destinatario}>
            {inviando ? 'Invio…' : 'Invia'}
          </button>
        </div>
      }
    >
      {avvisi.mese_futuro && <p className="avviso">{maiuscola(nomeMese)} non è ancora cominciato.</p>}
      {!avvisi.mese_futuro && avvisi.mese_non_finito && avvisi.giorni_mancanti > 0 && (
        <p className="avviso">
          Il mese non è ancora finito: mancano {avvisi.giorni_mancanti} {avvisi.giorni_mancanti === 1 ? 'giorno' : 'giorni'}. Dopo
          l&apos;invio non potrai più aggiungere ore: servirà che l&apos;amministratore riapra il mese.
        </p>
      )}
      {!avvisi.mese_futuro && avvisi.mese_non_finito && avvisi.giorni_mancanti === 0 && (
        <p className="avviso">Oggi è l&apos;ultimo giorno del mese: se oggi lavori ancora, registra prima le ore di oggi.</p>
      )}
      {avvisi.vuoto && (
        <p className="avviso">
          In {nomeMese} non hai registrato nessuna ora: il file avrà la griglia vuota
          {totali.sedute_pt > 0 ? ` e solo le sedute di personal training (${totali.sedute_pt})` : ''}.
        </p>
      )}
      {invio.sostituisce && (
        <p className="avviso">
          Il mese era stato riaperto: questo invio <b>sostituisce</b> la versione {invio.sostituisce.versione}, e l&apos;email lo dirà
          chiaramente.
        </p>
      )}
      <table className="totali riepilogo-invio">
        <tbody>
          <tr>
            <th scope="row">Ore</th>
            <td>{numero(totali.ore)}</td>
          </tr>
          {totali.sedute > 0 && (
            <tr>
              <th scope="row">Sedute (righe PT)</th>
              <td>{numero(totali.sedute)}</td>
            </tr>
          )}
          {totali.sedute_pt > 0 && (
            <tr>
              <th scope="row">Sedute PT con cliente</th>
              <td>{totali.sedute_pt}</td>
            </tr>
          )}
          <tr>
            <th scope="row">File</th>
            <td className="a-capo">{invio.nome_file}</td>
          </tr>
          <tr>
            <th scope="row">A</th>
            <td className="a-capo">{invio.destinatario ?? <span className="errore">manca: avvisa l&apos;amministratore</span>}</td>
          </tr>
          <tr>
            <th scope="row">In copia</th>
            <td className="a-capo">
              {invio.copia.map((e) => (
                <span key={e} className="indirizzo">
                  {e}
                </span>
              ))}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="dettaglio">
        In copia vanno i responsabili dei settori delle attività su cui hai registrato ore in {nomeMese}, più te. Dopo l&apos;invio il
        mese diventa di sola lettura.
      </p>
    </Foglio>
  );
}
