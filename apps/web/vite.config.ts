import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev -w @alibi/web` serves the UI on :5173 and passes API calls to the runner server on :4000.
const api = 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(['/runs', '/queue', '/tests', '/environments', '/reports'].map((p) => [p, api])),
  },
});
