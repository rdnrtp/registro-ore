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
};

function valore(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'sì' : 'no';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'nessuno';
  return String(v);
}

// Campi cambiati: { campo: { prima, dopo } } -> "nome: A → B; …"
function differenze(d) {
  return Object.entries(d)
    .filter(([, v]) => v && typeof v === 'object' && 'prima' in v && 'dopo' in v)
    .map(([k, v]) => `${NOMI_CAMPI[k] ?? k}: ${valore(v.prima)} → ${valore(v.dopo)}`)
    .join('; ');
}

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
      return d.scopo === 'reimposta'
        ? `ha creato un link per reimpostare la password di ${persona}`
        : `ha creato un link di invito per ${persona}`;
    case 'utente.attivato':
      return 'ha scelto la propria password (primo accesso)';
    case 'utente.password_reimpostata':
      return 'ha reimpostato la propria password con un link';
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
      return `ha cambiato l'indirizzo di invio delle ore: ${differenze(d)}`;
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
              <b>{v.autore ?? 'Comando da terminale'}</b> {descrivi(v)}
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
