import { useEffect, useState } from 'react';
import { api } from './api.js';
import { dataOra } from './GestioneUtenti.jsx';

const NOMI_CAMPI = {
  nome: 'nome',
  cognome: 'cognome',
  email: 'email',
  settori: 'settori',
  unita: 'unità',
  attiva: 'in uso',
  email_responsabili: 'email dei responsabili',
  responsabili: 'responsabili',
  esonerato_invio: 'non deve inviare il mese',
  email_invio: 'indirizzo di invio',
  promemoria: 'promemoria',
  titolo: 'titolo',
  testo: 'testo',
  importante: 'importante',
  destinatari: 'destinatari',
};

function valore(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'sì' : 'no';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'nessuno';
  // Promemoria: { giorni, ultimo_giorno, ora }
  if (typeof v === 'object' && 'giorni' in v) {
    const giorni = [...v.giorni, ...(v.ultimo_giorno ? ['ultimo'] : [])];
    return `giorni ${giorni.join(', ') || 'nessuno'} alle ${v.ora}`;
  }
  return String(v);
}

// Campi cambiati: { campo: { prima, dopo } } -> "nome: A → B; …"
function differenze(d) {
  return Object.entries(d)
    .filter(([, v]) => v && typeof v === 'object' && 'prima' in v && 'dopo' in v)
    .map(([k, v]) => `${NOMI_CAMPI[k] ?? k}: ${valore(v.prima)} → ${valore(v.dopo)}`)
    .join('; ');
}

// Da dove veniva il link usato per scegliere la password (migrazione 011).
const ORIGINI_LINK = {
  amministratore: "creato dall'amministratore",
  richiesta: 'chiesto con «Password dimenticata?»',
  terminale: 'creato con il comando da terminale',
};

// Chi ha fatto l'azione: un utente, oppure nessuno (comando da terminale,
// richiesta dalla pagina di accesso, che non ha un utente collegato).
const autore = (v) => v.autore ?? (v.dettagli.origine === 'richiesta' ? 'Pagina di accesso' : 'Comando da terminale');

function descrivi({ azione, dettagli: d }) {
  const persona = d.nome ? `${d.nome} ${d.cognome} (${d.email})` : '';
  switch (azione) {
    case 'utente.creato':
      return `ha creato l'utente ${persona}, ruolo ${d.ruolo}${d.settori?.length ? `, settori ${d.settori.join(', ')}` : ''}`;
    case 'utente.modificato':
      return `ha modificato ${persona}: ${differenze(d)}`;
    case 'utente.ruolo_cambiato':
      return `ha cambiato il ruolo di ${persona} da ${d.ruolo.prima} a ${d.ruolo.dopo}`;
    case 'utente.disattivato':
      return `ha disattivato ${persona}`;
    case 'utente.riattivato':
      return `ha riattivato ${persona}`;
    case 'utente.link_creato':
      if (d.origine === 'terminale') return `ha creato un link per reimpostare la password di ${persona} (comando link-password)`;
      return d.scopo === 'reimposta'
        ? `ha creato un link per reimpostare la password di ${persona}`
        : `ha creato un link di invito per ${persona}`;
    case 'utente.reset_richiesto':
      return `ha ricevuto una richiesta di nuova password per ${persona}: link mandato per email`;
    case 'utente.reset_ignorato':
      return `ha ricevuto una richiesta di nuova password per ${persona}: nessuna email, ${d.motivo}`;
    case 'utente.attivato':
      return `ha scelto la propria password (primo accesso${d.origine && d.origine !== 'amministratore' ? `, link ${ORIGINI_LINK[d.origine]}` : ''})`;
    case 'utente.password_reimpostata':
      return `ha reimpostato la propria password con un link${d.origine ? ` ${ORIGINI_LINK[d.origine] ?? ''}` : ''}; sessioni chiuse su tutti i dispositivi`;
    case 'attivita.modificata':
      return `ha modificato l'attività «${d.attivita}»: ${differenze(d)}`;
    case 'attivita.ordine_cambiato':
      return "ha cambiato l'ordine delle attività";
    case 'settore.creato':
      return `ha creato il settore «${d.nome}»`;
    case 'settore.modificato':
      return `ha modificato il settore «${d.settore}»: ${differenze(d)}`;
    case 'settore.eliminato':
      return `ha eliminato il settore «${d.settore}»`;
    case 'organizzazione.modificata':
      return `ha cambiato la configurazione dell'impianto: ${differenze(d)}`;
    case 'mese.riaperto':
      return `ha riaperto il mese ${d.mese}/${d.anno} di ${persona} (versione ${d.versione} inviata). Motivazione: «${d.motivazione}»`;
    case 'mese.sollecitato':
      return `ha sollecitato ${persona} a inviare il mese ${d.mese}/${d.anno}`;
    case 'avviso.pubblicato':
      return `ha pubblicato l'avviso «${d.titolo}» per ${(d.destinatari ?? []).join(', ')}${d.importante ? ' (importante)' : ''}`;
    case 'avviso.modificato':
      return `ha modificato l'avviso «${d.avviso}»: ${differenze(d)}`;
    case 'avviso.ritirato':
      return `ha ritirato l'avviso «${d.avviso}»`;
    case 'email.riprovata':
      return `ha rimesso in coda l'email «${d.oggetto}»`;
    case 'modello.caricato':
      return `ha caricato il modello Excel versione ${d.versione} (${d.nome_file})`;
    case 'organizzazione.creata_da_terminale':
      return `ha creato l'impianto con il comando carica-organizzazione (modello versione ${d.versione_modello})`;
    case 'organizzazione.sovrascritta_da_terminale':
      return `ha riportato la configurazione ai file con carica-organizzazione --sovrascrivi (modello versione ${d.versione_modello})`;
    default:
      return azione;
  }
}

export default function RegistroModifiche() {
  const [voci, setVoci] = useState([]);
  const [finito, setFinito] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState('');

  async function carica(salta = 0) {
    setCaricamento(true);
    try {
      const { voci: nuove } = await api.registroModifiche(salta);
      setVoci((v) => (salta ? [...v, ...nuove] : nuove));
      setFinito(nuove.length < 100);
    } catch (err) {
      setErrore(err.message);
    }
    setCaricamento(false);
  }
  useEffect(() => {
    carica();
  }, []);

  return (
    <>
      <p className="dettaglio">Le azioni di gestione, dalla più recente: utenti, ruoli, configurazione, modelli Excel.</p>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {!caricamento && voci.length === 0 && !errore && <p className="caricamento">Nessuna modifica registrata.</p>}
      <ol className="registro">
        {voci.map((v) => (
          <li key={v.id}>
            <small>{dataOra(v.quando)}</small>
            <span>
              <b>{autore(v)}</b> {descrivi(v)}
            </span>
          </li>
        ))}
      </ol>
      {caricamento && <p className="caricamento">Caricamento…</p>}
      {!caricamento && !finito && (
        <button type="button" className="neutro" onClick={() => carica(voci.length)}>
          Carica le precedenti
        </button>
      )}
    </>
  );
}
