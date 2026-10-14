import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// App installabile (manifest, icone in public/icone, service worker in
// public/sw.js). Il nome sotto l'icona sul telefono si cambia solo qui.
const NOME_APP = 'Presenze';
const COLORE_TEMA = '#0b6e99';
const COLORE_SFONDO = '#f2f5f7';

// Versione di questa compilazione: ogni rilascio che cambia il frontend ne
// ha una nuova (se il frontend non cambia, Docker riusa la compilazione e la
// versione resta quella: non c'è niente da aggiornare). L'app aperta la
// confronta con /versione.json per accorgersi di un rilascio.
const VERSIONE = new Date().toISOString();

const manifest = {
  // id fisso: anche cambiando nome resta la stessa app installata.
  id: '/',
  name: NOME_APP,
  short_name: NOME_APP,
  description: 'Registro delle ore di lavoro',
  lang: 'it',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: COLORE_SFONDO,
  theme_color: COLORE_TEMA,
  icons: [
    { src: '/icone/icona-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icone/icona-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icone/icona-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icone/icona-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

function appInstallabile() {
  const file = {
    'manifest.webmanifest': { tipo: 'application/manifest+json', testo: JSON.stringify(manifest, null, 2) },
    'versione.json': { tipo: 'application/json', testo: JSON.stringify({ versione: VERSIONE }) },
  };
  return {
    name: 'app-installabile',
    config: () => ({ define: { __VERSIONE__: JSON.stringify(VERSIONE) } }),
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%NOME_APP%', NOME_APP).replaceAll('%COLORE_TEMA%', COLORE_TEMA),
    },
    // npm run dev
    configureServer(server) {
      for (const [nome, { tipo, testo }] of Object.entries(file)) {
        server.middlewares.use(`/${nome}`, (req, res) => {
          res.setHeader('Content-Type', tipo);
          res.end(testo);
        });
      }
    },
    // npm run build: in dist/ accanto a index.html
    generateBundle() {
      for (const [nome, { testo }] of Object.entries(file)) this.emitFile({ type: 'asset', fileName: nome, source: testo });
    },
  };
}

// In sviluppo fuori da Docker (npm run dev) le chiamate /api vanno inoltrate
// all'API; in Docker lo fa nginx.
export default defineConfig({
  plugins: [react(), appInstallabile()],
  server: {
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
});
