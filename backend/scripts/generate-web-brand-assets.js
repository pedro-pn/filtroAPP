import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Originais de documentos permanecem intactos. Variantes da web recebem hash no Vite.
const root = fileURLToPath(new URL('../../', import.meta.url));
const target = path.join(root, 'frontend/src/assets/brand');
await fs.mkdir(target, { recursive: true });
for (const [source, filename, width] of [
  ['LOGO_LOGIN.png', 'login.webp', 640],
  ['LOGO_TAB.png', 'symbol.webp', 256],
  ['LOGO_TAB.png', 'favicon.png', 48]
]) {
  const image = sharp(path.join(root, 'backend/assets/Logo', source)).resize({ width, withoutEnlargement: true });
  const output = image[filename.endsWith('.webp') ? 'webp' : 'png'](filename.endsWith('.webp') ? { lossless: true } : {});
  const info = await output.toFile(path.join(target, filename));
  console.log(`${filename}: ${info.width}×${info.height}, ${info.size} bytes`);
}
