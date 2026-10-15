// API simulata per le prove nel browser: risponde a /api/* con dati
// plausibili (impianto "BV", ottobre 2026) senza server né database.
// Le risposte hanno la stessa forma di quelle vere (api/src/routes).

const OGGI = '2026-10-14';
const ADESSO = new Date('2026-10-14T10:00:00+02:00');

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IO = ID(1);
const COLLEGA = ID(2);
const AVVISO = ID(50);
// Chiave pubblica VAPID di esempio (punto P-256 non compresso, 65 byte).
const CHIAVE_PUSH = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

const SETTORI = [
  { id: ID(101), nome: 'Segreteria', ordine: 1, email_responsabili: ['segreteria@bv.test'], responsabili: [] },
  { id: ID(102), nome: 'Nuoto', ordine: 2, email_responsabili: ['nuoto@bv.test'], responsabili: [] },
  { id: ID(103), nome: 'Bagnini', ordine: 3, email_responsabili: ['bagnini@bv.test'], responsabili: [] },
];

const attivita = (n, nome, unita, settore, ordine) => ({
  id: ID(200 + n),
  nome,
  nome_modello: nome.toUpperCase(),
  unita,
  riga_modello: 3 + n,
  ordine,
  attiva: true,
  settori: [settore],
});
const ATTIVITA = [
  attivita(1, 'Segreteria', 'ore', ID(101), 1),
  attivita(2, 'Corsi nuoto', 'ore', ID(102), 2),
  attivita(3, 'Bagnino', 'ore', ID(103), 3),
  attivita(4, 'Pulizie/Manutenzione', 'ore', ID(101), 4),
  attivita(5, 'PT singola', 'sedute', ID(102), 5),
];

// Ottobre 2026 fino a oggi: ore nei giorni feriali.
function registrazioni() {
  const r = [];
  for (let g = 1; g <= 14; g++) {
    const data = `2026-10-${String(g).padStart(2, '0')}`;
    const settimana = new Date(`${data}T12:00:00Z`).getUTCDay();
    if (settimana === 0) continue;
    r.push({ data, attivita_id: ATTIVITA[1].id, quantita: settimana === 6 ? 3 : 4.5 });
    if (settimana !== 6) r.push({ data, attivita_id: ATTIVITA[2].id, quantita: 3 });
    if (g % 4 === 0) r.push({ data, attivita_id: ATTIVITA[4].id, quantita: 1 });
  }
  return r;
}

function mese(stato = 'aperto') {
  return {
    stato,
    max_sedute_pt_per_tipo: 27,
    registrazioni: registrazioni(),
    sedute_pt: [{ id: ID(300), data: '2026-10-06', tipo: 'acqua', cliente: 'Cliente di prova' }],
    invii:
      stato === 'inviato'
        ? [
            {
              versione: 1,
              inviato_il: '2026-10-14T08:30:00Z',
              nome_file: '10_Ottobre_2026_Petris.xlsx',
              destinatario: 'segreteria@bv.test',
              copia: ['nuoto@bv.test', 'andrea@bv.test'],
              ore: 80,
              sedute: 3,
              email: { stato: 'inviata', inviata_il: '2026-10-14T08:30:05Z', errore: null },
            },
          ]
        : [],
    precompilazione_annullabile: stato === 'aperto' ? 4 : 0,
  };
}

const UTENTI = [
  { id: IO, nome: 'Andrea', cognome: 'Petris', email: 'andrea@bv.test', ruolo: 'amministratore', attivo: true, esonerato_invio: false, password_impostata: true, invito_scadenza: null, settori: [], dispositivi_push: 1 },
  { id: COLLEGA, nome: 'Maria', cognome: 'Rossi', email: 'maria@bv.test', ruolo: 'collaboratore', attivo: true, esonerato_invio: false, password_impostata: true, invito_scadenza: null, settori: [] },
  { id: ID(3), nome: 'Luca', cognome: 'Bianchi', email: 'luca@bv.test', ruolo: 'responsabile', attivo: true, esonerato_invio: false, password_impostata: false, invito_scadenza: '2026-10-16T10:00:00Z', settori: [ID(102)] },
];

const collaboratore = (u, ore, extra) => ({
  id: u.id,
  nome: u.nome,
  cognome: u.cognome,
  attivo: true,
  ore,
  sedute: 0,
  stato: 'aperto',
  esonerato: false,
  inviato_il: null,
  versione: null,
  riaperto: false,
  manca: true,
  password_impostata: u.password_impostata,
  ultimo_sollecito: null,
  ...extra,
});

// opzioni: { ruolo, autenticato, statoMese, dispositiviPush }. Restituisce lo stato della
// simulazione (es. chiamate a password-dimenticata) per i controlli.
async function apiFinta(page, opzioni = {}) {
  const s = {
    ruolo: opzioni.ruolo ?? 'amministratore',
    autenticato: opzioni.autenticato ?? true,
    statoMese: opzioni.statoMese ?? 'aperto',
    dispositiviPush: opzioni.dispositiviPush ?? 0,
    richiesteReset: [],
  };
  await page.clock.setFixedTime(ADESSO);
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const percorso = url.pathname.replace(/^\/api/, '');
    const metodo = req.method();
    const json = (corpo, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    const io = { ...UTENTI[0], ruolo: s.ruolo, settori: s.ruolo === 'responsabile' ? [{ id: ID(102), nome: 'Nuoto' }] : [] };

    if (percorso === '/auth/login' && metodo === 'POST') {
      s.autenticato = true;
      return json({ ok: true });
    }
    if (percorso === '/auth/password-dimenticata' && metodo === 'POST') {
      s.richiesteReset.push(req.postDataJSON());
      return json({ ok: true, durata_minuti: 60 });
    }
    if ((percorso === '/auth/logout' || percorso === '/auth/esci-ovunque') && metodo === 'POST') {
      s.autenticato = false;
      return json({ ok: true });
    }
    if (!s.autenticato) return json({ errore: 'Accesso richiesto' }, 401);

    if (percorso.startsWith('/push/') && metodo !== 'GET') return json({ dispositivi: s.dispositiviPush });
    if (metodo !== 'GET') return json({ ok: true });

    const m = (re) => re.exec(percorso);
    let r;
    if (percorso === '/auth/me') {
      return json({
        utente: { id: io.id, email: io.email, nome: io.nome, cognome: io.cognome, ruolo: io.ruolo, settori: io.settori },
        organizzazione: { id: ID(900), nome: 'BV', slug: 'bv' },
      });
    }
    if (percorso === '/attivita') return json(ATTIVITA);
    if (percorso === '/mie-attivita') return json({ attivita: ATTIVITA.slice(1, 3).map((a) => a.id).concat(ATTIVITA[4].id) });
    if (percorso === '/settori') return json(SETTORI);
    if (percorso === '/orario-tipo') {
      return json({
        voci: [1, 2, 3, 4, 5].flatMap((g) => [
          { giorno_settimana: g, attivita_id: ATTIVITA[1].id, quantita: 4.5 },
          { giorno_settimana: g, attivita_id: ATTIVITA[2].id, quantita: 3 },
        ]),
      });
    }
    if ((r = m(/^\/mese\/(\d+)\/(\d+)$/))) return json(Number(r[2]) === 10 && Number(r[1]) === 2026 ? mese(s.statoMese) : { ...mese(), registrazioni: [], sedute_pt: [], precompilazione_annullabile: 0 });
    if (m(/^\/mese\/\d+\/\d+\/precompilazione$/)) return json({ giorni: ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'] });
    if (m(/^\/mese\/\d+\/\d+\/annulla-precompilazione$/)) return json({ giorni: ['2026-10-12', '2026-10-13'], righe: 4, ore: 15, sedute: 0 });
    if (m(/^\/mese\/\d+\/\d+\/invio$/)) {
      return json({
        stato: 'aperto',
        nome_file: '10_Ottobre_2026_Petris.xlsx',
        destinatario: 'segreteria@bv.test',
        copia: ['nuoto@bv.test', 'bagnini@bv.test', 'andrea@bv.test'],
        totali: { ore: 80, sedute: 3, sedute_pt: 1 },
        avvisi: { mese_futuro: false, mese_non_finito: true, giorni_mancanti: 17, vuoto: false },
        sostituisce: null,
      });
    }
    if (percorso === '/push') return json({ chiave_pubblica: CHIAVE_PUSH, dispositivi: s.dispositiviPush });
    if (percorso === '/avvisi/non-letti') return json({ non_letti: 1, importanti: 0 });
    if (percorso === '/avvisi') {
      return json({
        avvisi: [
          { id: AVVISO, titolo: 'Chiusura impianto per manutenzione', importante: true, da_leggere: true, letto_il: null, pubblicato_il: '2026-10-10T09:00:00Z', modificato_il: null, autore: 'Andrea Petris' },
        ],
      });
    }
    if (percorso === '/avvisi/gestione') {
      return json({
        avvisi: [
          { id: AVVISO, titolo: 'Chiusura impianto per manutenzione', importante: true, per_tutti: true, settori: [], pubblicato_il: '2026-10-10T09:00:00Z', modificato_il: null, ritirato_il: null, autore: 'Andrea Petris', letti: 1, destinatari: 3 },
        ],
      });
    }
    if (percorso === `/avvisi/${AVVISO}`) {
      return json({
        id: AVVISO,
        titolo: 'Chiusura impianto per manutenzione',
        testo: 'Sabato 24 ottobre la piscina resta chiusa.\nLe lezioni sono recuperate sabato 31.',
        importante: true,
        pubblicato_il: '2026-10-10T09:00:00Z',
        modificato_il: null,
        ritirato_il: null,
        autore: 'Andrea Petris',
        sono_destinatario: true,
        da_leggere: false,
        versioni_precedenti: [],
      });
    }
    if ((r = m(/^\/collaboratori\/(\d+)\/(\d+)$/))) {
      return json({
        anno: Number(r[1]),
        mese: Number(r[2]),
        collaboratori: [
          collaboratore(UTENTI[2], 0, { manca: true }),
          collaboratore(UTENTI[1], 72.5, { stato: 'inviato', manca: false, inviato_il: '2026-10-13T18:00:00Z', versione: 1 }),
          collaboratore(UTENTI[0], 80, {}),
        ],
      });
    }
    if ((r = m(/^\/collaboratori\/([0-9a-f-]{36})\/mese\/(\d+)\/(\d+)$/))) {
      return json({
        ...mese(),
        utente: { id: r[1], nome: 'Maria', cognome: 'Rossi', attivo: true, esonerato: false },
        anno: Number(r[2]),
        mese: Number(r[3]),
        inviato_il: null,
        solo_settori_propri: false,
      });
    }
    if (percorso === '/utenti') return json(UTENTI);
    if ((r = m(/^\/utenti\/([0-9a-f-]{36})$/))) return json(UTENTI.find((u) => u.id === r[1]));
    if (percorso === '/organizzazione') {
      return json({ nome: 'BV', slug: 'bv', email_invio: 'segreteria@bv.test', max_sedute_pt_per_tipo: 27, promemoria: { giorni: [25, 28], ultimo_giorno: true, ora: 9 } });
    }
    if (percorso === '/modello') return json({ versioni: [{ versione: 1, nome_file: 'modello_bv.xlsx', caricato_il: '2026-10-12T10:00:00Z', caricato_da: null }] });
    if (percorso === '/registro-modifiche') {
      return json({
        voci: [
          { id: ID(400), quando: '2026-10-14T09:00:00Z', azione: 'utente.reset_richiesto', dettagli: { nome: 'Maria', cognome: 'Rossi', email: 'maria@bv.test', origine: 'richiesta' }, autore: null },
          { id: ID(401), quando: '2026-10-13T09:00:00Z', azione: 'utente.creato', dettagli: { nome: 'Luca', cognome: 'Bianchi', email: 'luca@bv.test', ruolo: 'responsabile', settori: ['Nuoto'] }, autore: 'Andrea Petris' },
        ],
      });
    }
    if (url.pathname.startsWith('/api/email')) {
      return json({
        email: [
          { id: ID(500), tipo: 'invio_mese', stato: 'inviata', oggetto: 'Ore di Ottobre 2026 – Maria Rossi', a: ['segreteria@bv.test'], cc: ['nuoto@bv.test'], creata_il: '2026-10-13T18:00:00Z', inviata_il: '2026-10-13T18:00:05Z', tentativi: 1, errore: null, prossimo_tentativo: null, si_puo_riprovare: false },
        ],
      });
    }
    return json({ errore: 'Non trovato' }, 404);
  });
  return s;
}

module.exports = { apiFinta, OGGI, ID, COLLEGA, AVVISO };
