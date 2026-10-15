// Invio di una notifica push al servizio del browser (Google, Mozilla,
// Apple, Microsoft) con la libreria web-push: firma VAPID e contenuto
// cifrato per il dispositivo (il servizio push non può leggerlo).
const webpush = require('web-push');

// Durata massima di attesa del servizio push per un dispositivo spento:
// oltre, la notifica non serve più.
const DURATA_SECONDI = 24 * 3600;

// Restituisce invia(iscrizione, contenuto) → { stato } oppure lancia un
// errore con statusCode (risposta del servizio) o senza (rete).
// null se le push non sono configurate.
function creaInvioPush(configPush) {
  if (!configPush) return null;
  const vapidDetails = {
    subject: configPush.soggetto,
    publicKey: configPush.chiavePubblica,
    privateKey: configPush.chiavePrivata,
  };
  return async ({ endpoint, p256dh, auth }, contenuto) => {
    const r = await webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(contenuto), {
      vapidDetails,
      TTL: DURATA_SECONDI,
      urgency: 'normal',
      timeout: 15000,
    });
    return { stato: r.statusCode };
  };
}

module.exports = { creaInvioPush };
