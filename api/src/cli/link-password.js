// Comando d'emergenza: link per scegliere una nuova password, stampato a
// terminale invece che spedito. Serve quando l'invio delle email non
// funziona o quando l'unico amministratore non riesce più ad accedere.
// Uso: npm run link-password -- --email nome@esempio.it [--minuti 60]
// Il link vale una volta sola, scade dopo --minuti (predefinito
// RESET_DURATA_MINUTI, massimo 72 ore) e annulla i link precedenti non usati.
// Usarlo chiude le sessioni dell'utente su tutti i dispositivi. L'azione va
// nel registro delle modifiche come "Comando da terminale".
const { parseArgs } = require('node:util');
const { caricaConfig } = require('../config');
const { creaPool, transazione } = require('../db');
const { creaInvito } = require('../inviti');
const { traccia } = require('../traccia');
const { normalizzaEmail } = require('../validazione');
const { dataOraIt } = require('../tempo');

const USO = 'Uso: npm run link-password -- --email nome@esempio.it [--minuti 60]';
const MASSIMO_MINUTI = 72 * 60;

async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' }, minuti: { type: 'string' } } });
  if (!values.email?.trim()) throw new Error(`Parametro mancante: --email\n${USO}`);
  const config = caricaConfig();
  const minuti = values.minuti === undefined ? config.reimpostazione.durataMinuti : Number(values.minuti);
  if (!Number.isInteger(minuti) || minuti < 5 || minuti > MASSIMO_MINUTI) {
    throw new Error(`--minuti deve essere un numero intero tra 5 e ${MASSIMO_MINUTI}.\n${USO}`);
  }
  const email = normalizzaEmail(values.email);

  const pool = creaPool();
  try {
    const { utente, invito } = await transazione(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT u.id, u.organization_id, u.email, u.first_name AS nome, u.last_name AS cognome, u.active,
                o.name AS organizzazione
           FROM users u JOIN organizations o ON o.id = u.organization_id
          WHERE u.email = $1
          FOR NO KEY UPDATE OF u`,
        [email],
      );
      const u = rows[0];
      if (!u) throw new Error(`Nessun utente con email ${email}.`);
      if (!u.active) throw new Error(`L'utente ${email} è disattivato: il link non funzionerebbe. Riattivalo prima (Gestione → Utenti).`);
      const nuovo = await creaInvito(client, {
        organizzazioneId: u.organization_id,
        utenteId: u.id,
        creatoDa: null,
        durataMinuti: minuti,
        origine: 'terminale',
      });
      await traccia(client, {
        organizzazioneId: u.organization_id,
        utente: null,
        azione: 'utente.link_creato',
        tipo: 'utente',
        id: u.id,
        dettagli: { email: u.email, nome: u.nome, cognome: u.cognome, scopo: 'reimposta', origine: 'terminale', scadenza: nuovo.scadenza },
      });
      return { utente: u, invito: nuovo };
    });
    console.log(`Link per scegliere una nuova password di ${utente.nome} ${utente.cognome} (${utente.email}, ${utente.organizzazione}).`);
    console.log(`Vale una sola volta, fino al ${dataOraIt(invito.scadenza)}:`);
    console.log('');
    console.log(`${config.appUrl}/#/invito/${invito.codice}`);
    console.log('');
    console.log('Mandalo solo alla persona interessata, per un canale privato. Chi lo usa sceglie la password');
    console.log("ed entra; le sessioni aperte dell'utente si chiudono su tutti i dispositivi. I link precedenti");
    console.log('non ancora usati non valgono più. Il comando è nel registro delle modifiche.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
