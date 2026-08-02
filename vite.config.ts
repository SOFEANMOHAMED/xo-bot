import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiProxy = {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    };
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: apiProxy
      },
      // Same proxy as dev — preview serves dist/ but /api must still reach the backend
      preview: {
        port: 4173,
        host: '0.0.0.0',
        proxy: apiProxy
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      envPrefix: 'VITE_',
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
