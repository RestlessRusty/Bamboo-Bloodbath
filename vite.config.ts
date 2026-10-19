import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  // Relative base so the build works from any sub-path, e.g. https://<user>.github.io/<repo>/
  base: './',
  // Self-signed HTTPS so phones on the same Wi-Fi can open the dev server (WebRTC & sensors need it).
  plugins: [basicSsl()],
  server: { host: true },
  preview: { host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 4000 },
});
