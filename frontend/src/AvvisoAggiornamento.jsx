import { useEffect, useState } from 'react';
import { finestreAperte, modificheInSospeso } from './navigazione.js';

// Dopo un rilascio l'app già aperta (scheda del browser o app installata
// rimasta in sottofondo) sta ancora usando i file vecchi. Quando torna in
// primo piano, e comunque ogni mezz'ora, confronta la propria versione con
// /versione.json (mai in cache): se è cambiata si ricarica da sola, a meno
// che l'utente stia facendo qualcosa (una finestra aperta, modifiche non
// salvate). In quel caso compare un avviso con il pulsante "Aggiorna".
const OGNI = 30 * 60 * 1000;

async function versioneDelServer() {
  try {
    const r = await fetch('/versione.json', { cache: 'no-store' });
    return r.ok ? (await r.json()).versione : null;
  } catch {
    return null;
  }
}

export default function AvvisoAggiornamento() {
  const [nuova, setNuova] = useState(false);

  useEffect(() => {
    let inCorso = false;
    async function controlla() {
      if (inCorso || document.visibilityState !== 'visible') return;
      inCorso = true;
      const versione = await versioneDelServer();
      inCorso = false;
      if (!versione || versione === __VERSIONE__) return;
      if (finestreAperte() || modificheInSospeso()) setNuova(true);
      else window.location.reload();
    }
    document.addEventListener('visibilitychange', controlla);
    window.addEventListener('focus', controlla);
    const timer = setInterval(controlla, OGNI);
    return () => {
      document.removeEventListener('visibilitychange', controlla);
      window.removeEventListener('focus', controlla);
      clearInterval(timer);
    };
  }, []);

  if (!nuova) return null;
  return (
    <div className="avviso-aggiornamento" role="status">
      <span>È disponibile una versione nuova dell&apos;app.</span>
      <button type="button" className="piccolo" onClick={() => window.location.reload()}>
        Aggiorna
      </button>
    </div>
  );
}
