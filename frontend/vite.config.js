import { defineConfig } from 'vite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Certificates are outside Vite's served root. Never fall back to untrusted SSL.
const key = process.env.MIRO_TLS_KEY || fileURLToPath(new URL('../.certs/miro-key.pem', import.meta.url));
const cert = process.env.MIRO_TLS_CERT || fileURLToPath(new URL('../.certs/miro.pem', import.meta.url));
const useHttps = process.env.MIRO_HTTPS !== 'false';

export default defineConfig(({ command }) => {
  if (command === 'serve' && useHttps && (!fs.existsSync(key) || !fs.existsSync(cert))) {
    throw new Error('Trusted HTTPS certificate missing. Run npm run setup:https -- -LanIp <laptop-IP>; see NETWORK_SETUP.md.');
  }
  return {
    server: {
      host: useHttps ? '0.0.0.0' : '127.0.0.1',
      port: 5173,
      strictPort: true,
      https: command === 'serve' && useHttps ? { key: fs.readFileSync(key), cert: fs.readFileSync(cert) } : undefined,
      headers: { 'Permissions-Policy': 'geolocation=(self)' },
      fs: { strict: true, allow: [fileURLToPath(new URL('.', import.meta.url))] },
      proxy: {
        '/api': 'http://127.0.0.1:3000',
        '/health': 'http://127.0.0.1:3000',
        '/dashboard': 'http://127.0.0.1:3000',
        '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
      },
    },
  };
});
