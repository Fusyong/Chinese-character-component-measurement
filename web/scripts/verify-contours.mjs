import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontPath = path.join(__dirname, '../public/fonts/k.ttf');
const buf = fs.readFileSync(fontPath);
const font = opentype.parse(buf.buffer);

function countZ(char) {
  const glyph = font.charToGlyph(char);
  const p = glyph.getPath(0, 0, 512);
  let z = 0;
  for (const c of p.commands) if (c.type === 'Z') z++;
  return {
    char,
    contourByZ: z,
    numberOfContours: glyph.numberOfContours,
  };
}

const chars = ['十', '一', '二', '三'];
console.log('k contour check:');
for (const ch of chars) console.log(countZ(ch));
