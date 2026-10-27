import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { GIORNI_BREVI, NOMI_MESI, etichettaData, giornoSettimana, isoData, giorniDelMese, maiuscola } from './date.js';
import { dataOra } from './GestioneUtenti.jsx';
import Foglio from './Foglio.jsx';
import { salvaFile } from './VistaMese.jsx';

const MAX_RICEVUTE = 5;
// Come l'API: oltre, la foto non viene nemmeno inviata.
const MAX_FOTO_BYTE = 20 * 1024 * 1024;

export const euro = (centesimi) => (centesimi / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
export const mb = (byte) => `${(byte / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;

// "12,50" o "12.50" o "1.234,5" -> centesimi; null se non valido.
function leggiImporto(testo) {
  let t = testo.replace(/[\s€]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return null;
  const c = Math.round(Number(t) * 100);
  return c >= 1 && c <= 1_000_000 ? c : null;
}
const importoInTesto = (c) => (c / 100).toFixed(2).replace('.', ',');

const STATI_EMAIL = { in_attesa: 'email in partenza', inviata: 'email consegnata al server di posta', errore: 'email non partita' };

// Sezione "Spese di trasferta" del proprio mese: elenco, aggiunta, modifica,
// eliminazione (finché il mese è aperto e la spesa non è già partita),
// anteprima del PDF. nuova = contatore: quando cambia si apre una spesa
// nuova (voce "Aggiungi una spesa" del pannello Altro); aggiorna =
// contatore: quando cambia si rilegge l'elenco (dopo un invio).
export default function Spese({ anno, mese, oggi, solaLettura, nuova = 0, aggiorna = 0, onCambiate }) {
  const [dati, setDati] = useState(null);
  const [tipi, setTipi] = useState([]);
  const [errore, setErrore] = useState('');
  const [aperta, setAperta] = useState(null); // spesa in modifica, {} = nuova
  const [versione, setVersione] = useState(0);
  const [scaricando, setScaricando] = useState(false);
  const rif = useRef(null);
  const nuovaVista = useRef(nuova);

  useEffect(() => {
    let attivo = true;
    Promise.all([api.spese(anno, mese), api.tipiSpesa()])
      .then(([d, t]) => {
        if (!attivo) return;
        setDati(d);
        setTipi(t);
        setErrore('');
      })
      .catch((err) => attivo && setErrore(err.message));
    return () => {
      attivo = false;
    };
  }, [anno, mese, versione, aggiorna]);

  const futuro = isoData(anno, mese, 1) > oggi;
  const puoAggiungere = dati && !solaLettura && !futuro;

  useEffect(() => {
    if (nuova === nuovaVista.current) return;
    nuovaVista.current = nuova;
    rif.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setAperta({});
  }, [nuova]);

  const ricarica = () => {
    setVersione((v) => v + 1);
    onCambiate?.();
  };

  async function scaricaPdf() {
    setErrore('');
    setScaricando(true);
    try {
      const { blob, nomeFile } = await api.pdfSpese(anno, mese);
      salvaFile(blob, nomeFile ?? `Spese_${anno}_${mese}.pdf`);
    } catch (err) {
      setErrore(err.message);
    }
    setScaricando(false);
  }

  const subito = dati?.modalita === 'subito';
  const daInviare = dati?.spese.filter((s) => !s.inviata) ?? [];

  return (
    <section className="sezione spese" aria-labelledby="titolo-spese" ref={rif}>
      <h2 id="titolo-spese">Spese di trasferta</h2>
      {!dati && !errore && <p className="caricamento">Caricamento…</p>}
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {dati && (
        <>
          <p className="dettaglio">
            {subito
              ? 'Pedaggi, carburante, parcheggi, pasti: ogni spesa parte per email alla segreteria appena la confermi.'
              : 'Pedaggi, carburante, parcheggi, pasti: partono alla segreteria con l’invio del mese, in un PDF con le ricevute.'}
          </p>
          <ElencoSpese
            spese={dati.spese}
            onApri={(s) => setAperta(s)}
            urlRicevuta={(a) => `/api/spese/allegati/${a.id}`}
          />
          {!subito && daInviare.length > 0 && !solaLettura && (
            <p className="dettaglio">
              Ricevute da inviare: {mb(dati.dimensione_ricevute)} su {mb(dati.limite)} che l&apos;email può portare.
            </p>
          )}
          <div className="comandi-spese">
            {puoAggiungere && (
              <button type="button" onClick={() => setAperta({})}>
                Aggiungi spesa
              </button>
            )}
            {(solaLettura ? dati.spese.length > 0 && !subito : daInviare.length > 0) && (
              <button type="button" className="neutro" onClick={scaricaPdf} disabled={scaricando}>
                {scaricando ? 'Preparo il PDF…' : solaLettura ? 'Scarica il PDF inviato' : 'Anteprima del PDF'}
              </button>
            )}
          </div>
        </>
      )}
      {aperta && (
        <SchedaSpesa
          spesa={aperta.id ? aperta : null}
          anno={anno}
          mese={mese}
          oggi={oggi}
          tipi={tipi}
          subito={subito}
          solaLettura={solaLettura || Boolean(aperta.inviata)}
          limiteRicevute={dati?.limite}
          onChiudi={() => setAperta(null)}
          onSalvata={() => {
            setAperta(null);
            ricarica();
          }}
        />
      )}
    </section>
  );
}

// Elenco delle spese (anche nel mese di un collega, per l'amministratore).
// urlRicevuta(a) = indirizzo della ricevuta per le miniature.
export function ElencoSpese({ spese, onApri, urlRicevuta }) {
  if (!spese.length) return <p className="vuoto-spese">Nessuna spesa in questo mese.</p>;
  const totale = spese.reduce((t, s) => t + s.importo_centesimi, 0);
  return (
    <>
      <ul className="elenco-spese">
        {spese.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onApri(s)} aria-label={`${etichettaData(s.data)}, ${s.tipo}, ${euro(s.importo_centesimi)}`}>
              <span className="spesa-riga">
                <span className="pt-data">
                  {GIORNI_BREVI[giornoSettimana(s.data) - 1]} {Number(s.data.slice(8))}
                </span>
                <span className="spesa-tipo">{s.tipo}</span>
                <span className="spesa-importo">{euro(s.importo_centesimi)}</span>
              </span>
              <span className="spesa-motivo">{s.motivo}</span>
              <span className="spesa-ricevute">
                {s.allegati.map((a) =>
                  a.tipo === 'image/jpeg' ? (
                    <img key={a.id} src={urlRicevuta(a)} alt="" loading="lazy" />
                  ) : (
                    <span key={a.id} className="icona-pdf">
                      PDF
                    </span>
                  ),
                )}
                {s.inviata && (
                  <small className={`stato-email ${s.inviata.email?.stato ?? ''}`}>
                    Inviata il {dataOra(s.inviata.il)}
                    {s.inviata.email && ` · ${STATI_EMAIL[s.inviata.email.stato] ?? s.inviata.email.stato}`}
                  </small>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="totale-spese">
        Totale: <b>{euro(totale)}</b> ({spese.length === 1 ? '1 spesa' : `${spese.length} spese`})
      </p>
    </>
  );
}

// Ricevuta aperta: le foto nella pagina, i PDF si scaricano.
export function VediRicevuta({ ricevuta, url, onChiudi }) {
  return (
    <Foglio titolo={ricevuta.nome} onChiudi={onChiudi}>
      <img className="ricevuta-grande" src={url} alt={`Ricevuta ${ricevuta.nome}`} />
    </Foglio>
  );
}

// Scheda di una spesa: nuova (spesa = null), da modificare, oppure in sola
// lettura (mese inviato o spesa già partita).
function SchedaSpesa({ spesa, anno, mese, oggi, tipi, subito, solaLettura, limiteRicevute, onChiudi, onSalvata }) {
  const ultimo = isoData(anno, mese, giorniDelMese(anno, mese).length);
  const [data, setData] = useState(spesa?.data ?? (oggi < ultimo ? oggi : ultimo));
  const [tipo, setTipo] = useState(spesa?.tipo_id ?? '');
  const [importo, setImporto] = useState(spesa ? importoInTesto(spesa.importo_centesimi) : '');
  const [motivo, setMotivo] = useState(spesa?.motivo ?? '');
  const [ricevute, setRicevute] = useState(spesa?.allegati ?? []);
  const [caricando, setCaricando] = useState([]); // nomi dei file in caricamento
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);
  const [conferma, setConferma] = useState(false); // eliminazione
  const [vista, setVista] = useState(null);
  // Ricevute caricate in questa scheda: se si annulla, si cancellano.
  const nuove = useRef(new Set());
  const salvata = useRef(false);

  useEffect(
    () => () => {
      if (salvata.current) return;
      for (const id of nuove.current) api.eliminaRicevuta(id).catch(() => {});
    },
    [],
  );

  const scelti = tipi.filter((t) => t.attivo || t.id === spesa?.tipo_id);
  const centesimi = leggiImporto(importo);
  const pronta = data && tipo && centesimi && motivo.trim() && ricevute.length > 0 && !caricando.length;

  async function aggiungiFile(evento) {
    const file = [...(evento.target.files ?? [])];
    evento.target.value = '';
    setErrore('');
    const posto = MAX_RICEVUTE - ricevute.length - caricando.length;
    if (file.length > posto) {
      setErrore(`Al massimo ${MAX_RICEVUTE} ricevute per spesa.`);
      file.splice(posto);
    }
    for (const f of file) {
      const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      if (!pdf && f.size > MAX_FOTO_BYTE) {
        setErrore(`${f.name}: la foto è di ${mb(f.size)}, al massimo ${mb(MAX_FOTO_BYTE)}.`);
        continue;
      }
      if (pdf && limiteRicevute && f.size > limiteRicevute) {
        setErrore(`${f.name}: il PDF è di ${mb(f.size)}, al massimo ${mb(limiteRicevute)}. Prova a fotografare la ricevuta.`);
        continue;
      }
      setCaricando((c) => [...c, f.name]);
      try {
        const r = await api.caricaRicevuta(f);
        nuove.current.add(r.id);
        setRicevute((x) => [...x, r]);
      } catch (err) {
        setErrore(`${f.name}: ${err.message}`);
      }
      setCaricando((c) => c.filter((n, i) => i !== c.indexOf(f.name)));
    }
  }

  function togli(r) {
    setRicevute((x) => x.filter((y) => y.id !== r.id));
    // Una ricevuta appena caricata si cancella subito; quelle già salvate
    // le cancella il server al salvataggio.
    if (nuove.current.delete(r.id)) api.eliminaRicevuta(r.id).catch(() => {});
  }

  async function apri(r) {
    if (r.tipo === 'image/jpeg') return setVista(r);
    try {
      const { blob, nomeFile } = await api.ricevuta(r.id);
      salvaFile(blob, nomeFile ?? r.nome);
    } catch (err) {
      setErrore(err.message);
    }
  }

  async function salva() {
    setErrore('');
    if (!centesimi) {
      setErrore('Importo non valido: scrivilo in euro, per esempio 12,50.');
      return;
    }
    setInvio(true);
    const corpo = { data, tipo_id: tipo, importo_centesimi: centesimi, motivo, allegati: ricevute.map((r) => r.id) };
    try {
      if (spesa) await api.modificaSpesa(spesa.id, corpo);
      else await api.aggiungiSpesa(corpo);
      salvata.current = true;
      onSalvata();
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
    }
  }

  async function elimina() {
    setInvio(true);
    try {
      await api.eliminaSpesa(spesa.id);
      salvata.current = true;
      onSalvata();
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
      setConferma(false);
    }
  }

  async function scaricaInviata() {
    try {
      const { blob, nomeFile } = await api.pdfSpesa(spesa.id);
      salvaFile(blob, nomeFile ?? 'Spesa.pdf');
    } catch (err) {
      setErrore(err.message);
    }
  }

  const titolo = spesa ? maiuscola(etichettaData(spesa.data)) : `Nuova spesa · ${maiuscola(NOMI_MESI[mese - 1])}`;
  const piede = (
    <>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {solaLettura ? (
        <button type="button" onClick={onChiudi}>
          Chiudi
        </button>
      ) : conferma ? (
        <>
          <p>Eliminare questa spesa e le sue ricevute?</p>
          <div className="pulsanti">
            <button type="button" className="neutro" onClick={() => setConferma(false)}>
              No
            </button>
            <button type="button" className="conferma-pericolo" onClick={elimina} disabled={invio}>
              Sì, elimina
            </button>
          </div>
        </>
      ) : (
        <>
          {subito && <p className="avviso">Confermando, la spesa parte subito per email alla segreteria e non si potrà più modificare.</p>}
          <div className="pulsanti">
            <button type="button" className="neutro" onClick={onChiudi}>
              Annulla
            </button>
            <button type="button" onClick={salva} disabled={invio || !pronta}>
              {invio ? 'Salvataggio…' : subito ? 'Conferma e invia' : 'Salva'}
            </button>
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      <Foglio titolo={titolo} onChiudi={onChiudi} piede={piede}>
        {solaLettura && (
          <p className="avviso">
            {spesa?.inviata
              ? `Spesa inviata alla segreteria il ${dataOra(spesa.inviata.il)}: è in sola lettura.`
              : 'Il mese è già stato inviato: le spese sono in sola lettura.'}
          </p>
        )}
        <div className="form-spesa">
          <label>
            Data
            <input
              type="date"
              value={data}
              min={isoData(anno, mese, 1)}
              max={oggi < ultimo ? oggi : ultimo}
              onChange={(e) => setData(e.target.value)}
              disabled={solaLettura}
              required
            />
          </label>
          <fieldset className="tipi-spesa" disabled={solaLettura}>
            <legend>Tipo</legend>
            <div className="scelta a-capo" role="radiogroup" aria-label="Tipo di spesa">
              {scelti.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={tipo === t.id}
                  className={tipo === t.id ? 'scelto' : ''}
                  onClick={() => setTipo(t.id)}
                >
                  {t.nome}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            Importo in euro
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              autoComplete="off"
              value={importo}
              onChange={(e) => setImporto(e.target.value)}
              disabled={solaLettura}
              aria-invalid={importo !== '' && !centesimi}
            />
          </label>
          <label>
            Motivo della trasferta
            <textarea rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={solaLettura} />
          </label>

          <div className="ricevute">
            <b>Ricevute ({ricevute.length} di {MAX_RICEVUTE})</b>
            {ricevute.length > 0 && (
              <ul className="elenco-ricevute">
                {ricevute.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="apri-ricevuta" onClick={() => apri(r)}>
                      {r.tipo === 'image/jpeg' ? (
                        <img src={`/api/spese/allegati/${r.id}`} alt="" />
                      ) : (
                        <span className="icona-pdf">PDF</span>
                      )}
                      <span className="nome-ricevuta">
                        {r.nome}
                        <small>
                          {mb(r.dimensione)}
                          {r.pagine > 1 && ` · ${r.pagine} pagine`}
                        </small>
                      </span>
                    </button>
                    {!solaLettura && (
                      <button type="button" className="elimina" aria-label={`Togli ${r.nome}`} onClick={() => togli(r)}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {caricando.map((n, i) => (
              <p key={`${n}-${i}`} className="caricamento">
                Carico {n}…
              </p>
            ))}
            {!solaLettura && ricevute.length + caricando.length < MAX_RICEVUTE && (
              <div className="pulsanti-ricevuta">
                {/* Sul telefono "capture" apre direttamente la fotocamera. */}
                <label className="pulsante-file">
                  Scatta foto
                  <input type="file" accept="image/*" capture="environment" onChange={aggiungiFile} />
                </label>
                <label className="pulsante-file neutro">
                  Scegli file
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.heic,.heif,.pdf"
                    multiple
                    onChange={aggiungiFile}
                  />
                </label>
              </div>
            )}
            {!solaLettura && (
              <p className="dettaglio">
                Foto (JPEG, PNG, HEIC dell&apos;iPhone) o PDF. Le foto vengono ridotte e ripulite dai dati nascosti, come la posizione.
              </p>
            )}
          </div>
          {spesa?.inviata && (
            <button type="button" className="neutro" onClick={scaricaInviata}>
              Scarica il PDF inviato
            </button>
          )}
          {spesa && !solaLettura && !conferma && (
            <button type="button" className="piccolo pericolo elimina-spesa" onClick={() => setConferma(true)} disabled={invio}>
              Elimina spesa
            </button>
          )}
        </div>
      </Foglio>
      {/* Sopra la scheda: Indietro chiude prima la ricevuta. */}
      {vista && <VediRicevuta ricevuta={vista} url={`/api/spese/allegati/${vista.id}`} onChiudi={() => setVista(null)} />}
    </>
  );
}

// Una spesa di un collega, per l'amministratore: dati e ricevute, in sola
// lettura. utenteId = il collega.
export function SpesaDelCollega({ spesa, utenteId, onChiudi }) {
  const [vista, setVista] = useState(null);
  const [errore, setErrore] = useState('');
  const url = (r) => `/api/collaboratori/${utenteId}/spese/allegati/${r.id}`;

  async function scarica(azione, nome) {
    setErrore('');
    try {
      const { blob, nomeFile } = await azione();
      salvaFile(blob, nomeFile ?? nome);
    } catch (err) {
      setErrore(err.message);
    }
  }

  return (
    <>
      <Foglio titolo={maiuscola(etichettaData(spesa.data, true))} onChiudi={onChiudi}>
        <table className="totali">
          <tbody>
            <tr>
              <th scope="row">Tipo</th>
              <td>{spesa.tipo}</td>
            </tr>
            <tr>
              <th scope="row">Importo</th>
              <td>{euro(spesa.importo_centesimi)}</td>
            </tr>
            <tr>
              <th scope="row">Motivo</th>
              <td className="a-capo">{spesa.motivo}</td>
            </tr>
            {spesa.inviata && (
              <tr>
                <th scope="row">Inviata</th>
                <td>{dataOra(spesa.inviata.il)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <ul className="elenco-ricevute">
          {spesa.allegati.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="apri-ricevuta"
                onClick={() => (r.tipo === 'image/jpeg' ? setVista(r) : scarica(() => api.ricevutaDi(utenteId, r.id), r.nome))}
              >
                {r.tipo === 'image/jpeg' ? <img src={url(r)} alt="" /> : <span className="icona-pdf">PDF</span>}
                <span className="nome-ricevuta">
                  {r.nome}
                  <small>{mb(r.dimensione)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {spesa.inviata && (
          <button type="button" className="neutro" onClick={() => scarica(() => api.pdfSpesaDi(utenteId, spesa.id), 'Spesa.pdf')}>
            Scarica il PDF inviato
          </button>
        )}
        {errore && (
          <p className="errore" role="alert">
            {errore}
          </p>
        )}
      </Foglio>
      {vista && <VediRicevuta ricevuta={vista} url={url(vista)} onChiudi={() => setVista(null)} />}
    </>
  );
}
