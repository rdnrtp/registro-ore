import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { NOMI_MESI, maiuscola, meseVicino, numero, oggiIso } from './date.js';
import SedutePt from './SedutePt.jsx';
import { ElencoGiorni, NavigazioneMese, TotaliMese, salvaFile, usaRiepilogo } from './VistaMese.jsx';

// Mese di un altro utente in sola lettura. Il responsabile vede solo le righe
// dei suoi settori; l'amministratore tutto, sedute PT comprese, e può
// scaricare il file Excel.
export default function MeseCollaboratore({ id, anno, mese, attivita, utente }) {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState('');
  const [nonVisibile, setNonVisibile] = useState(false);
  const [scaricando, setScaricando] = useState(false);
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
  }, [id, anno, mese]);

  const perId = useMemo(() => new Map(attivita.map((a) => [a.id, a])), [attivita]);
  const { perGiorno, totali } = usaRiepilogo(dati?.registrazioni, perId);
  const nomeMese = `${NOMI_MESI[mese - 1]} ${anno}`;
  const vai = (delta) => {
    const m = meseVicino(anno, mese, delta);
    window.location.hash = `#/collaboratori/${id}/${m.anno}/${m.mese}`;
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

  return (
    <div className="mese">
      <div className="testata-mese">
        <a className="indietro" href={`#/collaboratori/${anno}/${mese}`}>
          ‹ Tutti i collaboratori
        </a>
        <NavigazioneMese titolo={maiuscola(nomeMese)} onPrecedente={() => vai(-1)} onSuccessivo={() => vai(1)} />
        {dati && (
          <div className="azioni-mese">
            <span className="riassunto">
              <b>{persona}</b> · {numero(totali.ore)} ore
              {totali.sedute > 0 && ` · ${numero(totali.sedute)} sedute`}
            </span>
            {admin && (
              <button type="button" className="piccolo" onClick={scaricaExcel} disabled={scaricando}>
                {scaricando ? 'Preparo il file…' : 'Scarica Excel'}
              </button>
            )}
          </div>
        )}
      </div>

      {errore && (
        <p className="errore riquadro" role="alert">
          {errore}
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
            Sola lettura: le registrazioni le modifica solo {persona}. Mese {dati.stato}.
            {dati.solo_settori_propri && ' Vedi solo le attività dei tuoi settori.'}
            {!dati.utente.attivo && ' Utente disattivato.'}
          </p>
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
        </>
      )}
    </div>
  );
}
