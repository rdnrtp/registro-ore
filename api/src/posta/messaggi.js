// Testi delle email che non sono notifiche: link di invito e invio del mese.
// Contengono il minimo di dati personali: nome, mese, file; niente ore
// giorno per giorno, niente nomi dei clienti (stanno nell'allegato).
const { NOMI_MESI } = require('../validazione');
const { dataOraIt } = require('../tempo');
const { NOME_APP } = require('../notifiche');

const nomeMese = (anno, mese) => `${NOMI_MESI[mese - 1]} ${anno}`;

// Link per scegliere la password (nuovo utente o password dimenticata).
function emailInvito({ nome, organizzazione, url, privacy, scadenza, reimposta }) {
  const oggetto = reimposta
    ? `${NOME_APP} – ${organizzazione}: link per reimpostare la password`
    : `${NOME_APP} – ${organizzazione}: il tuo accesso`;
  const testo = [
    `Ciao ${nome},`,
    '',
    reimposta
      ? `ecco il link per scegliere una nuova password per ${NOME_APP} (${organizzazione}):`
      : `l'amministratore ti ha creato un accesso a ${NOME_APP} (${organizzazione}), l'app per registrare le ore di lavoro. Per entrare scegli la tua password da questo link:`,
    '',
    url,
    '',
    `Il link è personale, funziona una sola volta e scade il ${dataOraIt(scadenza)}.`,
    reimposta
      ? 'Se non hai chiesto tu di reimpostare la password, ignora questa email: la password attuale resta valida.'
      : "Se non ti aspettavi questa email, ignorala.",
    '',
    `Come vengono trattati i tuoi dati: ${privacy}`,
    '',
    '—',
    `${organizzazione} · ${NOME_APP}`,
    'Email automatica: per favore non rispondere.',
  ];
  return { oggetto, testo: testo.join('\n') };
}

// File del mese alla segreteria. sostituisce = data dell'invio precedente
// (dopo una riapertura), altrimenti null.
function emailInvioMese({ nome, cognome, anno, mese, nomeFile, organizzazione, versione, sostituisce }) {
  const chi = `${nome} ${cognome}`;
  const quale = `${nomeMese(anno, mese)}`;
  const oggetto = sostituisce
    ? `SOSTITUISCE IL PRECEDENTE – Ore di ${quale} – ${chi}`
    : `Ore di ${quale} – ${chi}`;
  const testo = [
    'Buongiorno,',
    '',
    `in allegato il file delle ore di ${quale} di ${chi} (${nomeFile}).`,
  ];
  if (sostituisce) {
    testo.push(
      '',
      `ATTENZIONE: questo invio (versione ${versione}) SOSTITUISCE quello del ${dataOraIt(sostituisce)}.`,
      'Il file inviato in precedenza non è più valido: va usato solo quello allegato a questa email.',
    );
  }
  testo.push(
    '',
    `Per rispondere, rispondete a questa email: arriva a ${nome}.`,
    '',
    '—',
    `Inviato con ${NOME_APP} · ${organizzazione}`,
  );
  return { oggetto, testo: testo.join('\n'), nomeMittente: `${chi} tramite ${NOME_APP}` };
}

module.exports = { emailInvito, emailInvioMese, nomeMese };
