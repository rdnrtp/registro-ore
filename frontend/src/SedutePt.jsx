import { useRef, useState } from 'react';
import { api } from './api.js';
import { GIORNI_BREVI, NOMI_MESI, giornoSettimana, giorniDelMese, isoData } from './date.js';

const TIPI = [
  { valore: 'acqua', nome: 'Acqua' },
  { valore: 'palestra', nome: 'Palestra' },
];

// Sedute di personal training del mese: data, tipo e cliente. Per ora non
// sono collegate alle quantità delle righe "PT …" della griglia.
export default function SedutePt({ anno, mese, oggi, sedute, massimo, solaLettura, onCambiate }) {
  const ultimo = giorniDelMese(anno, mese).length;
  const dataPredefinita = oggi.startsWith(isoData(anno, mese, 1).slice(0, 8)) ? oggi : isoData(anno, mese, 1);
  const [data, setData] = useState(dataPredefinita);
  const [tipo, setTipo] = useState('acqua');
  const [cliente, setCliente] = useState('');
  const [errore, setErrore] = useState('');
  const rifModulo = useRef(null);
  const [invio, setInvio] = useState(false);
  // Seduta che si sta modificando (null = il modulo aggiunge una seduta nuova).
  const [inModifica, setInModifica] = useState(null);

  const conta = (t) => sedute.filter((s) => s.tipo === t).length;
  // Modificando una seduta dello stesso tipo il posto è già suo.
  const pieno = conta(tipo) - (inModifica?.tipo === tipo ? 1 : 0) >= massimo;

  function annullaModifica() {
    setInModifica(null);
    setCliente('');
    setData(dataPredefinita);
    setErrore('');
  }

  function modifica(s) {
    setInModifica(s);
    setData(s.data);
    setTipo(s.tipo);
    setCliente(s.cliente);
    setErrore('');
    rifModulo.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function salva(evento) {
    evento.preventDefault();
    setErrore('');
    setInvio(true);
    try {
      if (inModifica) await api.modificaSedutaPt(inModifica.id, { data, tipo, cliente });
      else await api.aggiungiSedutaPt({ data, tipo, cliente });
      setInModifica(null);
      setCliente('');
      onCambiate();
    } catch (err) {
      setErrore(err.message);
    }
    setInvio(false);
  }

  async function elimina(s) {
    const [, , g] = s.data.split('-');
    if (!window.confirm(`Eliminare la seduta del ${Number(g)} ${NOMI_MESI[mese - 1]} con ${s.cliente}?`)) return;
    setErrore('');
    try {
      await api.eliminaSedutaPt(s.id);
      if (inModifica?.id === s.id) annullaModifica();
      onCambiate();
    } catch (err) {
      setErrore(err.message);
    }
  }

  return (
    <section className="sezione" aria-labelledby="titolo-pt">
      <h2 id="titolo-pt">Sedute di personal training</h2>
      <p className="contatori-pt">
        {TIPI.map((t) => (
          <span key={t.valore} className={conta(t.valore) >= massimo ? 'esaurito' : ''}>
            {t.nome}: <b>{conta(t.valore)}</b> di {massimo}
          </span>
        ))}
      </p>

      {!solaLettura && (
        <form className="form-pt" onSubmit={salva} ref={rifModulo}>
          {inModifica && <p className="avviso">Stai modificando la seduta con {inModifica.cliente}.</p>}
          <div className="scelta" role="radiogroup" aria-label="Tipo di seduta">
            {TIPI.map((t) => (
              <button
                key={t.valore}
                type="button"
                role="radio"
                aria-checked={tipo === t.valore}
                className={tipo === t.valore ? 'scelto' : ''}
                onClick={() => setTipo(t.valore)}
              >
                {t.nome}
              </button>
            ))}
          </div>
          <label>
            Data
            <input
              type="date"
              value={data}
              min={isoData(anno, mese, 1)}
              max={isoData(anno, mese, ultimo)}
              onChange={(e) => setData(e.target.value)}
              required
            />
          </label>
          <label>
            Nome del cliente
            <input
              type="text"
              value={cliente}
              maxLength={100}
              autoComplete="off"
              autoCapitalize="words"
              onChange={(e) => setCliente(e.target.value)}
              required
            />
          </label>
          {pieno && (
            <p className="avviso">
              Hai già {massimo} sedute in {tipo} questo mese: il modello Excel ha spazio per {massimo} sedute per tipo,
              quindi non se ne possono aggiungere altre{inModifica ? ' né spostarne qui' : ''}.
            </p>
          )}
          {errore && (
            <p className="errore" role="alert">
              {errore}
            </p>
          )}
          {inModifica ? (
            <div className="pulsanti">
              <button type="button" className="neutro" onClick={annullaModifica}>
                Annulla
              </button>
              <button type="submit" disabled={invio || pieno}>
                Salva modifica
              </button>
            </div>
          ) : (
            <button type="submit" disabled={invio || pieno}>
              Aggiungi seduta
            </button>
          )}
        </form>
      )}
      {solaLettura && errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}

      {sedute.length > 0 && (
        <ul className="elenco-pt">
          {sedute.map((s) => (
            <li key={s.id}>
              <span className="pt-data">
                {GIORNI_BREVI[giornoSettimana(s.data) - 1]} {Number(s.data.slice(8))}
              </span>
              <span className={`pt-tipo ${s.tipo}`}>{s.tipo}</span>
              <span className="pt-cliente">{s.cliente}</span>
              {!solaLettura && (
                <>
                  <button
                    type="button"
                    className="modifica"
                    aria-label={`Modifica la seduta con ${s.cliente}`}
                    aria-pressed={inModifica?.id === s.id}
                    onClick={() => modifica(s)}
                  >
                    ✎
                  </button>
                  <button type="button" className="elimina" aria-label={`Elimina la seduta con ${s.cliente}`} onClick={() => elimina(s)}>
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
