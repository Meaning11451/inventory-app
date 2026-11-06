import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';

// Resize the selected brand artwork; no lettering or design is redrawn here.
const input = process.argv[2] || 'icons/icon-512x512.png';
const source = await readFile(input);
await mkdir('icons', { recursive: true });
for (const size of [72, 96, 128, 144, 152, 180, 192, 384, 512]) {
  await sharp(source).resize(size, size, { fit: 'contain', background: '#105532' }).png({ compressionLevel: 9 }).toFile(`icons/icon-${size}x${size}.png`);
}
await sharp(source).resize(32, 32).png({ compressionLevel: 9 }).toFile('icons/favicon-32x32.png');
await sharp(source).resize(410, 410).extend({ top: 51, bottom: 51, left: 51, right: 51, background: '#105532' }).png({ compressionLevel: 9 }).toFile('icons/icon-maskable-512x512.png');
console.log('Generated brand icons, Apple touch icon, favicon and maskable icon.');
