// Service worker dell'app installabile. Volutamente minimo: NON mette in
// cache niente, né le pagine né i file dell'app né (soprattutto) i dati
// dell'API. Ogni apertura scarica dal server la versione in uso, quindi dopo
// un rilascio l'app installata è già aggiornata (vedi AvvisoAggiornamento.jsx
// per l'app rimasta aperta in sottofondo).
// Unico compito: se manca la connessione, invece della pagina di errore del
// browser mostra un messaggio in italiano.

const PAGINA_OFFLINE = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b6e99"><title>Nessuna connessione</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;
font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f2f5f7;color:#1d2730}
main{max-width:360px;background:#fff;border-radius:12px;padding:24px 20px;text-align:center}
a{display:block;margin-top:16px;padding:14px;border-radius:8px;background:#0b6e99;color:#fff;font-weight:600;text-decoration:none}</style>
</head><body><main><h1>Nessuna connessione</h1><p>Il registro funziona solo online: le ore sono salvate sul server.
Controlla la rete e riprova.</p><a href="/">Riprova</a></main></body></html>`;

// Una versione nuova di questo file prende il posto della vecchia subito,
// senza aspettare che si chiudano tutte le finestre dell'app.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Nessuna cache: si tolgono anche eventuali residui.
      for (const nome of await caches.keys()) await caches.delete(nome);
      // La pagina parte a scaricarsi mentre il service worker si avvia.
      await self.registration.navigationPreload?.enable();
      await self.clients.claim();
    })(),
  );
});

// Solo l'apertura delle pagine; tutto il resto (file, /api) va in rete
// direttamente, come se il service worker non ci fosse.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) || (await fetch(event.request));
      } catch {
        return new Response(PAGINA_OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })(),
  );
});
