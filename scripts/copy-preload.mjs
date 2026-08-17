import fs from 'node:fs';
import path from 'node:path';

fs.mkdirSync('dist-electron', { recursive: true });
fs.copyFileSync(path.join('electron', 'preload.cjs'), path.join('dist-electron', 'preload.cjs'));
console.log('preload.cjs copié vers dist-electron/');
