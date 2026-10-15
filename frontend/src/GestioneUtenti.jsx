import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Foglio from './Foglio.jsx';

export const RUOLI = [
  { valore: 'collaboratore', nome: 'Collaboratore', descrizione: 'registra le proprie ore' },
  { valore: 'responsabile', nome: 'Responsabile', descrizione: 'vede anche le ore dei suoi settori' },
  { valore: 'amministratore', nome: 'Amministratore', descrizione: 'vede tutto e gestisce la configurazione' },
];

export const dataOra = (iso) =>
  new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' });

// Link di invito appena creato: si vede solo ora (nel database c'è solo
// l'hash), quindi va copiato e mandato subito.
function LinkInvito({ invito, persona, onChiudi }) {
  const url = `${window.location.origin}/#/invito/${invito.codice}`;
  const campo = useRef(null);
  const [copiato, setCopiato] = useState(false);

  async function copia() {
    try {
      // navigator.clipboard funziona solo in HTTPS (o su localhost).
      await navigator.clipboard.writeText(url);
    } catch {
      campo.current.select();
      document.execCommand('copy');
    }
    setCopiato(true);
  }

  return (
    <Foglio
      titolo="Link per la password"
      onChiudi={onChiudi}
      piede={
        <div className="pulsanti">
          {navigator.share && (
            <button type="button" className="neutro" onClick={() => navigator.share({ title: 'Registro ore', url }).catch(() => {})}>
              Condividi
            </button>
          )}
          <button type="button" onClick={copia}>
            {copiato ? 'Copiato ✓' : 'Copia il link'}
          </button>
        </div>
      }
    >
      <p>
        Il link è stato mandato per email a <b>{invito.email ?? persona.email}</b>. Se non arriva, mandalo a{' '}
        <b>{persona.nome}</b> con un altro mezzo (messaggio…): aprendolo sceglierà la propria password e accederà con quell&apos;email.
      </p>
      <input ref={campo} className="link-invito" type="text" value={url} readOnly onFocus={(e) => e.target.select()} />
      <p className="dettaglio">
        Funziona una sola volta, entro il {dataOra(invito.scadenza)}. Chiusa questa finestra non lo potrai più vedere:
        se si perde, crea un nuovo link (quello vecchio smette di funzionare).
      </p>
    </Foglio>
  );
}

export function SceltaSettori({ settori, scelti, onCambia }) {
  if (!settori.length) return <p className="dettaglio">Non ci sono settori: creali nella pagina Settori.</p>;
  return (
    <ul className="scelte-attivita">
      {settori.map((s) => (
        <li key={s.id}>
          <label className={scelti.includes(s.id) ? 'scelta-attiva' : ''}>
            <input
              type="checkbox"
              checked={scelti.includes(s.id)}
              onChange={() => onCambia(scelti.includes(s.id) ? scelti.filter((x) => x !== s.id) : [...scelti, s.id])}
            />
            <span>{s.nome}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

// Creazione (utente = null) o modifica di un utente.
function SchedaUtente({ utente, settori, io, onSalvato, onChiudi, onLink }) {
  const [dati, setDati] = useState(() => ({
    nome: utente?.nome ?? '',
    cognome: utente?.cognome ?? '',
    email: utente?.email ?? '',
    ruolo: utente?.ruolo ?? 'collaboratore',
    settori: utente?.settori ?? [],
    esonerato_invio: utente?.esonerato_invio ?? false,
  }));
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);
  const cambia = (campo) => (e) => setDati({ ...dati, [campo]: e.target.value });
  const sonoIo = utente?.id === io.id;

  async function esegui(azione) {
    setErrore('');
    setInvio(true);
    try {
      await azione();
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
    }
  }

  const salva = (evento) => {
    evento?.preventDefault();
    const corpo = { ...dati, settori: dati.ruolo === 'responsabile' ? dati.settori : [] };
    return esegui(async () => {
      if (utente) onSalvato(await api.modificaUtente(utente.id, corpo));
      else {
        const { utente: nuovo, invito } = await api.creaUtente(corpo);
        onLink(nuovo, invito);
      }
    });
  };
  const cambiaStato = (attivo) => {
    const domanda = attivo
      ? `Riattivare ${utente.nome} ${utente.cognome}?`
      : `Disattivare ${utente.nome} ${utente.cognome}? Non potrà più accedere, da subito. Le ore registrate restano.`;
    if (!window.confirm(domanda)) return;
    esegui(async () => onSalvato(await api.modificaUtente(utente.id, { attivo })));
  };
  const nuovoLink = () => {
    const domanda = utente.password_impostata
      ? `Creare un link per reimpostare la password di ${utente.nome}? La password attuale resta valida finché il link non viene usato.`
      : `Creare un nuovo link di invito per ${utente.nome}? Il link precedente smette di funzionare.`;
    if (!window.confirm(domanda)) return;
    esegui(async () => onLink(utente, await api.nuovoInvito(utente.id)));
  };

  return (
    <Foglio
      titolo={utente ? `${utente.nome} ${utente.cognome}` : 'Nuovo utente'}
      onChiudi={onChiudi}
      piede={
        <>
          {errore && (
            <p className="errore" role="alert">
              {errore}
            </p>
          )}
          <div className="pulsanti">
            <button type="button" className="neutro" onClick={onChiudi}>
              Annulla
            </button>
            <button type="submit" form="form-utente" disabled={invio}>
              {utente ? 'Salva' : 'Crea e manda il link'}
            </button>
          </div>
        </>
      }
    >
      <form id="form-utente" className="form-gestione" onSubmit={salva}>
        <label>
          Nome
          <input value={dati.nome} onChange={cambia('nome')} required maxLength={100} autoCapitalize="words" />
        </label>
        <label>
          Cognome
          <input value={dati.cognome} onChange={cambia('cognome')} required maxLength={100} autoCapitalize="words" />
        </label>
        <label>
          Email (serve per accedere)
          <input type="email" value={dati.email} onChange={cambia('email')} required inputMode="email" autoComplete="off" />
        </label>
        <fieldset>
          <legend>Ruolo</legend>
          {RUOLI.map((r) => (
            <label key={r.valore} className="opzione">
              <input
                type="radio"
                name="ruolo"
                value={r.valore}
                checked={dati.ruolo === r.valore}
                onChange={cambia('ruolo')}
              />
              <span>
                {r.nome} <small>{r.descrizione}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="opzione">
          <input
            type="checkbox"
            checked={dati.esonerato_invio}
            onChange={(e) => setDati({ ...dati, esonerato_invio: e.target.checked })}
          />
          <span>
            Non deve inviare il mese <small>per esempio chi non lavora a ore: niente promemoria e fuori dal quadro degli invii</small>
          </span>
        </label>
        {dati.ruolo === 'responsabile' && (
          <fieldset>
            <legend>Responsabile dei settori</legend>
            <SceltaSettori settori={settori} scelti={dati.settori} onCambia={(s) => setDati({ ...dati, settori: s })} />
          </fieldset>
        )}
      </form>
      {utente && (
        <div className="azioni-utente">
          {utente.attivo && (
            <button type="button" className="neutro" onClick={nuovoLink} disabled={invio}>
              {utente.password_impostata ? 'Link per reimpostare la password' : 'Nuovo link di invito'}
            </button>
          )}
          {!sonoIo &&
            (utente.attivo ? (
              <button type="button" className="pericolo" onClick={() => cambiaStato(false)} disabled={invio}>
                Disattiva
              </button>
            ) : (
              <button type="button" className="neutro" onClick={() => cambiaStato(true)} disabled={invio}>
                Riattiva
              </button>
            ))}
        </div>
      )}
    </Foglio>
  );
}

function statoAccesso(u) {
  if (!u.attivo) return 'disattivato';
  if (u.password_impostata) return null;
  if (u.invito_scadenza) return `non ha ancora scelto la password (link valido fino al ${dataOra(u.invito_scadenza)})`;
  return 'non ha ancora scelto la password e il link è scaduto: creane uno nuovo';
}

export default function GestioneUtenti({ utente: io }) {
  const [utenti, setUtenti] = useState(null);
  const [settori, setSettori] = useState([]);
  const [errore, setErrore] = useState('');
  const [aperto, setAperto] = useState(undefined); // undefined = chiuso, null = nuovo
  const [link, setLink] = useState(null);

  const carica = () =>
    Promise.all([api.utenti(), api.settori()])
      .then(([u, s]) => {
        setUtenti(u);
        setSettori(s);
      })
      .catch((err) => setErrore(err.message));
  useEffect(() => {
    carica();
  }, []);

  const nomeSettore = new Map(settori.map((s) => [s.id, s.nome]));
  const ordinati = utenti ? [...utenti].sort((a, b) => Number(b.attivo) - Number(a.attivo)) : [];

  return (
    <>
      <p className="dettaglio">
        Chi viene creato riceve un link personale per scegliere la password: nessuno, nemmeno l&apos;amministratore, conosce
        la password degli altri.
      </p>
      <button type="button" className="nuovo" onClick={() => setAperto(null)}>
        + Nuovo utente
      </button>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {!utenti && !errore && <p className="caricamento">Caricamento…</p>}
      <ul className="elenco-persone">
        {ordinati.map((u) => (
          <li key={u.id}>
            <button type="button" className={u.attivo ? '' : 'spento'} onClick={() => setAperto(u)}>
              <span className="persona-nome">
                {u.cognome} {u.nome}
                {u.id === io.id && <small> (tu)</small>}
                <small>{u.email}</small>
                {u.ruolo === 'responsabile' && (
                  <small>Settori: {u.settori.length ? u.settori.map((id) => nomeSettore.get(id)).join(', ') : 'nessuno'}</small>
                )}
                {statoAccesso(u) && <small className="nota">{statoAccesso(u)}</small>}
                {u.esonerato_invio && <small>non deve inviare il mese</small>}
                {u.dispositivi_push > 0 && (
                  <small className="push-attive">
                    Notifiche push attive{u.dispositivi_push > 1 ? ` su ${u.dispositivi_push} dispositivi` : ''}
                  </small>
                )}
              </span>
              <span className={`etichetta ${u.ruolo}`}>{u.ruolo}</span>
            </button>
          </li>
        ))}
      </ul>

      {aperto !== undefined && (
        <SchedaUtente
          key={aperto?.id ?? 'nuovo'}
          utente={aperto}
          settori={settori}
          io={io}
          onChiudi={() => setAperto(undefined)}
          onSalvato={() => {
            setAperto(undefined);
            carica();
          }}
          onLink={(persona, invito) => {
            setAperto(undefined);
            setLink({ persona, invito });
            carica();
          }}
        />
      )}
      {link && <LinkInvito invito={link.invito} persona={link.persona} onChiudi={() => setLink(null)} />}
    </>
  );
}
