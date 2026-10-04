/**
 * Copie les polices standard de pdf.js dans `public/`, d'où Vite les sert puis
 * les recopie dans `dist/`.
 *
 * La plupart des formulaires n'embarquent pas Helvetica ni Times : sans ces
 * fichiers, pdf.js n'aurait rien à dessiner et leur texte disparaîtrait. Les
 * tables CMap (écritures CJK) ne sont pas copiées — 1,5 Mo pour un cas que
 * cette application ne vise pas.
 */
import fs from 'node:fs';
import path from 'node:path';

const from = path.join('node_modules', 'pdfjs-dist', 'standard_fonts');
const to = path.join('public', 'standard_fonts');

if (!fs.existsSync(from)) {
  console.error(`Polices pdf.js introuvables : ${from}`);
  process.exit(1);
}

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`polices pdf.js copiées vers ${to}/`);
