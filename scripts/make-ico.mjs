// Packs PNG icons into a favicon.ico (PNG-in-ICO, supported by all current browsers).
// Run after scripts/make-icons.ps1: node scripts/make-ico.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '..', 'assets', 'brand');
const sizes = [32, 48];
const pngs = sizes.map((s) => fs.readFileSync(path.join(DIR, `icon-${s}.png`)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + 16 * pngs.length;
const entries = pngs.map((png, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0);
  e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1);
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});

fs.writeFileSync(path.join(DIR, 'favicon.ico'), Buffer.concat([header, ...entries, ...pngs]));
console.log(`favicon.ico written (${sizes.join(', ')} px)`);
