import sharp from 'sharp';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Use the supplied trademark pixels without redrawing its lettering or border.
const input = process.argv[2] || '.impeccable/assets/app-icon-source.jpg';
const source = await readFile(input);
const origin = 'User-supplied San Sheng Da trademark image, provided 2026-11-06. Original lettering, colors and border retained; outer blank margin cropped and artwork resized proportionally on white.';
const crop = { left: 165, top: 614, width: 1719, height: 865 };
const xmp = `<?xpacket begin="﻿"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:source>${origin}</dc:source></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
await mkdir('icons', { recursive: true });
for (const [size, fraction, file] of [
  [180, 0.94, 'app-icon-180.png'],
  [192, 0.94, 'app-icon-192.png'],
  [512, 0.94, 'app-icon-512.png'],
  [512, 0.70, 'app-icon-maskable-512.png']
]) {
  const emblem = await sharp(source).extract(crop).resize({ width: Math.round(size * fraction), height: size, fit: 'inside' }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } })
    .composite([{ input: emblem, gravity: 'centre' }]).withXmp(xmp)
    .png({ compressionLevel: 9 }).toFile(`icons/${file}`);
}
await writeFile('icons/app-icon-provenance.json', JSON.stringify({
  origin, source_sha256: createHash('sha256').update(source).digest('hex'), source_size: [2048, 2048], crop,
  processing: 'Sharp: proportional resize and centered white square. Maskable emblem stays inside the central 80% safe circle. No generated or redrawn artwork.',
  outputs: ['app-icon-180.png', 'app-icon-192.png', 'app-icon-512.png', 'app-icon-maskable-512.png'],
  scope: 'Installed desktop and home-screen icons only; existing in-page branding and favicon retained.'
}, null, 2) + '\n');
console.log('Created installed-app icons from the supplied trademark.');
