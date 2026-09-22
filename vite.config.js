import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        projects: fileURLToPath(new URL('./index.html', import.meta.url)),
        ear: fileURLToPath(new URL('./ear/index.html', import.meta.url)),
        neurofly: fileURLToPath(new URL('./neurofly/index.html', import.meta.url)),
      },
    },
  },
});
