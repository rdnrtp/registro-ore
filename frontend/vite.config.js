import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In sviluppo fuori da Docker (npm run dev) le chiamate /api vanno inoltrate
// all'API; in Docker lo fa nginx.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
});
