import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { NOMI_MESI, maiuscola, meseVicino, numero, oggiIso } from './date.js';
import { dataOra } from './GestioneUtenti.jsx';
import Foglio from './Foglio.jsx';
import SedutePt from './SedutePt.jsx';
import StatoInvio from './StatoInvio.jsx';
import { ElencoSpese, SpesaDelCollega } from './Spese.jsx';
import { naviga } from './navigazione.js';
import { ElencoGiorni, NavigazioneMese, TotaliMese, salvaFile, usaRiepilogo } from './VistaMese.jsx';

// Mese di un altro utente in sola lettura. Il responsabile vede solo le righe
// dei suoi settori; l'amministratore tutto, sedute PT e spese comprese, e può
// scaricare il file Excel e il PDF delle spese.
export default function MeseCollaboratore({ id, anno, mese, attivita, utente }) {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState('');
  const [nonVisibile, setNonVisibile] = useState(false);
  const [scaricando, setScaricando] = useState(false);
  const [versione, setVersione] = useState(0);
  const [riapertura, setRiapertura] = useState(null); // testo della motivazione, null = chiuso
  const [avviso, setAvviso] = useState('');
  const [attesa, setAttesa] = useState(false);
  const [spesa, setSpesa] = useState(null); // spesa aperta
  const admin = utente.ruolo === 'amministratore';

  useEffect(() => {
    let attivo = true;
    setDati(null);
    setErrore('');
    setNonVisibile(false);
    api
      .meseDi(id, anno, mese)
      .then((d) => attivo && setDati(d))
      .catch((err) => {
        if (!attivo) return;
        if (err.stato === 404) setNonVisibile(true);
        else setErrore(err.message);
      });
    return () => {
      attivo = false;
    };
  }, [id, anno, mese, versione]);

  const perId = useMemo(() => new Map(attivita.map((a) => [a.id, a])), [attivita]);
  const { perGiorno, totali } = usaRiepilogo(dati?.registrazioni, perId);
  const nomeMese = `${NOMI_MESI[mese - 1]} ${anno}`;
  const vai = (delta) => {
    const m = meseVicino(anno, mese, delta);
    naviga(`#/collaboratori/${id}/${m.anno}/${m.mese}`);
  };
  const persona = dati ? `${dati.utente.nome} ${dati.utente.cognome}` : '';

  async function scaricaExcel() {
    setErrore('');
    setScaricando(true);
    try {
      const { blob, nomeFile } = await api.excelDi(id, anno, mese);
      salvaFile(blob, nomeFile ?? `${anno}-${mese}.xlsx`);
    } catch (err) {
      setErrore(err.message);
    } finally {
      setScaricando(false);
    }
  }

  async function scarica(azione, nome) {
    setErrore('');
    try {
      const { blob, nomeFile } = await azione();
      salvaFile(blob, nomeFile ?? nome);
    } catch (err) {
      setErrore(err.message);
    }
  }
  const scaricaVersione = (v) => scarica(() => api.fileInviatoDi(id, anno, mese, v), `${anno}-${mese}.xlsx`);
  const scaricaSpeseVersione = (v) => scarica(() => api.pdfSpeseInviatoDi(id, anno, mese, v), `Spese_${anno}_${mese}.pdf`);

  async function esegui(azione, messaggio) {
    setErrore('');
    setAvviso('');
    setAttesa(true);
    try {
      await azione();
      setAvviso(messaggio);
      setVersione((x) => x + 1);
    } catch (err) {
      setErrore(err.message);
    }
    setAttesa(false);
  }

  const riapri = () =>
    esegui(async () => {
      await api.riapriMese(id, anno, mese, riapertura);
      setRiapertura(null);
    }, `Mese riaperto: ${persona} riceve un'email con la motivazione e potrà correggere e inviare di nuovo.`);
  const sollecita = () =>
    window.confirm(`Mandare a ${persona} un'email per ricordargli di inviare ${nomeMese}?`) &&
    esegui(() => api.sollecita(id, anno, mese), `Sollecito mandato a ${persona}.`);

  return (
    <div className="mese">
      <div className="testata-mese">
        <a className="indietro" href={`#/collaboratori/${anno}/${mese}`}>
          ‹ Tutti i collaboratori
        </a>
        <NavigazioneMese titolo={maiuscola(nomeMese)} onPrecedente={() => vai(-1)} onSuccessivo={() => vai(1)} />
        <div className="totale-mese">
          <p className="riassunto">
            {dati ? (
              <>
                <span className="persona-mese">{persona}</span>
                <span className="ore-mese">
                  <b>{numero(totali.ore)}</b> ore
                </span>
                {totali.sedute > 0 && (
                  <span className="sedute-mese">
                    <b>{numero(totali.sedute)}</b> sedute
                  </span>
                )}
              </>
            ) : (
              <>&nbsp;</>
            )}
          </p>
        </div>
      </div>
      {dati && admin && (
        <div className="comandi-mese">
          <button type="button" className="neutro" onClick={scaricaExcel} disabled={scaricando}>
            {scaricando ? 'Preparo il file…' : 'Scarica Excel'}
          </button>
          {dati.stato === 'inviato' && (
            <button type="button" className="neutro" onClick={() => setRiapertura('')} disabled={attesa}>
              Riapri il mese
            </button>
          )}
          {dati.stato !== 'inviato' && dati.utente.attivo && !dati.utente.esonerato && (
            <button type="button" className="neutro" onClick={sollecita} disabled={attesa}>
              Sollecita
            </button>
          )}
        </div>
      )}

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
      {nonVisibile && (
        <p className="avviso riquadro">
          {admin ? 'Utente non trovato.' : `In ${nomeMese} questa persona non ha registrazioni nei tuoi settori.`}
        </p>
      )}
      {!dati && !errore && !nonVisibile && <p className="caricamento">Caricamento…</p>}
      {dati && (
        <>
          <p className="avviso riquadro">
            Sola lettura: le registrazioni le modifica solo {persona}. Mese {dati.stato}
            {dati.inviato_il && ` il ${dataOra(dati.inviato_il)}`}.
            {dati.utente.esonerato && ' Esonerato dall’invio del mese.'}
            {dati.solo_settori_propri && ' Vedi solo le attività dei tuoi settori.'}
            {!dati.utente.attivo && ' Utente disattivato.'}
          </p>
          {admin && (
            <StatoInvio stato={dati.stato} invii={dati.invii} onScarica={scaricaVersione} onScaricaSpese={scaricaSpeseVersione} />
          )}
          <ElencoGiorni anno={anno} mese={mese} perGiorno={perGiorno} perId={perId} oggi={oggiIso()} />
          <TotaliMese nomeMese={nomeMese} totali={totali} perId={perId} />
          {dati.sedute_pt && (
            <SedutePt
              anno={anno}
              mese={mese}
              oggi={oggiIso()}
              sedute={dati.sedute_pt}
              massimo={dati.max_sedute_pt_per_tipo}
              solaLettura
              onCambiate={() => {}}
            />
          )}
          {/* Solo l'amministratore riceve le spese (null per il responsabile). */}
          {dati.spese && (
            <section className="sezione spese" aria-labelledby="titolo-spese">
              <h2 id="titolo-spese">Spese di trasferta</h2>
              <ElencoSpese
                spese={dati.spese}
                onApri={setSpesa}
                urlRicevuta={(a) => `/api/collaboratori/${id}/spese/allegati/${a.id}`}
              />
              {dati.spese.some((s) => !s.inviata) && (
                <div className="comandi-spese">
                  <button
                    type="button"
                    className="neutro"
                    onClick={() => scarica(() => api.pdfSpeseDi(id, anno, mese), `Spese_${anno}_${mese}.pdf`)}
                  >
                    {dati.stato === 'inviato' ? 'Scarica il PDF inviato' : 'Anteprima del PDF'}
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {spesa && <SpesaDelCollega spesa={spesa} utenteId={id} onChiudi={() => setSpesa(null)} />}

      {riapertura !== null && (
        <Foglio
          titolo={`Riapri ${nomeMese}`}
          onChiudi={() => setRiapertura(null)}
          piede={
            <>
              {errore && (
                <p className="errore" role="alert">
                  {errore}
                </p>
              )}
            <div className="pulsanti">
              <button type="button" className="neutro" onClick={() => setRiapertura(null)}>
                Annulla
              </button>
              <button type="button" onClick={riapri} disabled={attesa || !riapertura.trim()}>
                Riapri
              </button>
            </div>
            </>
          }
        >
          <p>
            {persona} potrà di nuovo modificare il mese e dovrà inviarlo un&apos;altra volta: la nuova email dirà che sostituisce
            quella precedente. Il file già inviato resta tra le versioni.
          </p>
          <label>
            Motivazione (la riceve {persona} per email e resta nel registro delle modifiche)
            <textarea rows={3} maxLength={1000} value={riapertura} onChange={(e) => setRiapertura(e.target.value)} />
          </label>
        </Foglio>
      )}
    </div>
  );
}
