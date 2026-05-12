// Author: Joao Machete
// Description: Vite configuration file for the project, including environment variable loading, process.env polyfills, and path alias setup for simplified imports. Ensures correct build and development environment for the app.

import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        chunkSizeWarningLimit: 7000,
        rollupOptions: {
          output: {
            manualChunks: {
              vendor: ['react', 'react-dom'],
              d3: ['d3'],
              markdown: ['react-markdown', 'rehype-highlight'],
              webllm: ['@mlc-ai/web-llm'],
            }
          }
        }
      },
      optimizeDeps: {
        exclude: ['@mlc-ai/web-llm'],
      },
    };
});
