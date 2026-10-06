import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL('../../output/playwright/preview-build', import.meta.url));
await build({
  configFile: false,
  root: frontend,
  base: './',
  plugins: [react()],
  build: {
    outDir: output,
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      input: fileURLToPath(new URL('index.html', import.meta.url)),
      output: { codeSplitting: false },
    },
  },
});
let html = await readFile(`${output}/design-preview/index.html`, 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
for (const [tag, relative] of scripts) {
  const js = await readFile(fileURLToPath(new URL(relative, `file://${output}/design-preview/index.html`)), 'utf8');
  html = html.replace(tag, () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
}
const styles = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)];
for (const [tag, relative] of styles) {
  const css = await readFile(fileURLToPath(new URL(relative, `file://${output}/design-preview/index.html`)), 'utf8');
  html = html.replace(tag, () => `<style>${css}</style>`);
}
const destination = fileURLToPath(new URL('../../output/playwright/acompanhamento-preview.html', import.meta.url));
await mkdir(fileURLToPath(new URL('../../output/playwright', import.meta.url)), { recursive: true });
await writeFile(destination, html);
console.log(`Prévia independente: ${destination}`);
