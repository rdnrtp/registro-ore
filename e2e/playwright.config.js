// Prove nel browser: Chromium di Playwright, come Chrome su un telefono
// Android, contro il frontend compilato servito da nginx (servizio "web").
// L'API è simulata (test/api-finta.js): i dati non toccano nessun database.
// Uso: docker compose run --rm --build e2e
const { defineConfig, devices } = require('@playwright/test');

// Sempre localhost (origine "sicura": service worker ammesso); nel Compose
// inoltro.js porta localhost:8088 a web:80.
const BASE_URL = 'http://localhost:8088';

module.exports = defineConfig({
  testDir: './test',
  outputDir: './risultati/tracce',
  timeout: 30_000,
  workers: 2,
  reporter: [['list']],
  globalSetup: require.resolve('./inoltro.js'),
  use: {
    baseURL: BASE_URL,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    // Il service worker lo provano solo i test che lo attivano.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'telefono', use: { ...devices['Pixel 7'] } }],
});
