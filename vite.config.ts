import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const BACKEND_TARGET = 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ws': {
        target: BACKEND_TARGET,
        ws: true,
      },
      '/api': {
        target: BACKEND_TARGET,
      },
      '/healthz': {
        target: BACKEND_TARGET,
      },
    },
  },
});
