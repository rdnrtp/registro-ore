// Manda un avviso tecnico (es. backup fallito) ad ALLARMI_EMAIL.
// Uso: echo "testo" | npm run avviso-sistema -- --oggetto "Backup fallito"
//
// Va direttamente al server SMTP, senza passare dalla coda nel database:
// l'avviso deve partire anche quando il problema è proprio il database.
const { parseArgs } = require('node:util');
const { caricaConfig } = require('../config');
const { creaTrasporto } = require('../posta/trasporto');
const { NOME_APP } = require('../notifiche');

async function leggiIngresso() {
  if (process.stdin.isTTY) return '';
  const parti = [];
  for await (const p of process.stdin) parti.push(p);
  return Buffer.concat(parti).toString('utf8');
}

async function main() {
  const { values } = parseArgs({ options: { oggetto: { type: 'string' } } });
  if (!values.oggetto?.trim()) throw new Error('Uso: npm run avviso-sistema -- --oggetto "..." (testo da stdin)');
  const config = caricaConfig();
  if (!config.allarmiEmail) throw new Error('ALLARMI_EMAIL non impostato: nessun destinatario per l\'avviso');
  const trasporto = creaTrasporto(config.posta);
  if (!trasporto) throw new Error('SMTP_HOST non impostato: impossibile mandare l\'avviso');
  const testo = (await leggiIngresso()).trim() || values.oggetto;
  await trasporto.sendMail({
    from: { name: `${NOME_APP} (server)`, address: config.posta.mittente },
    to: config.allarmiEmail,
    subject: `[${NOME_APP}] ${values.oggetto.trim()}`,
    text: `${testo}\n\n—\nAvviso automatico del server di ${config.appUrl}`,
  });
  console.log(`Avviso inviato a ${config.allarmiEmail}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
