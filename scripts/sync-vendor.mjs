/**
 * Copies runtime vendor files that the client references into client/vendor,
 * so the same HTML works when served by Express and when bundled into the
 * Android app (Capacitor only copies the webDir, not node_modules).
 *
 * Run: npm run build:web
 */
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'leaflet', 'dist');
const DEST = path.join(ROOT, 'client', 'vendor', 'leaflet');

await mkdir(path.join(DEST, 'images'), { recursive: true });

let copied = 0;
for (const file of ['leaflet.js', 'leaflet.css']) {
  await cp(path.join(SRC, file), path.join(DEST, file));
  copied += 1;
}

for (const image of ['marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png', 'layers.png', 'layers-2x.png']) {
  try {
    await cp(path.join(SRC, 'images', image), path.join(DEST, 'images', image));
    copied += 1;
  } catch {
    // Optional asset in some Leaflet releases.
  }
}

console.log(`[darjam] copied ${copied} vendor files to client/vendor/leaflet`);
