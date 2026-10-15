import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { avviaNavigazione, naviga } from './navigazione.js';
import './stile.css';

avviaNavigazione();

// App installabile: service worker minimo, senza cache (public/sw.js). Solo
// nella versione compilata e solo in HTTPS (o su localhost): altrove il
// browser non lo permette e l'app funziona comunque.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker non registrato:', err));
  });
  // Tocco su una notifica con l'app già aperta (sw.js): si va alla pagina
  // come con un collegamento interno, così Indietro risale come sempre.
  navigator.serviceWorker.addEventListener('message', (e) => {
    const link = e.data?.tipo === 'apri' ? e.data.link : null;
    if (typeof link === 'string' && link.startsWith('#/')) naviga(link);
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
