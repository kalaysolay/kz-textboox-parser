#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, dependency, findBinary, VERSION, args } from './lib/textbook-runtime.js';

try {
  const a = args(process.argv.slice(2), ['help']);
  if (a.help) console.log('parser-doctor.js [--model-dir DIR] [--lang rus|kaz+rus]');
  else {
    const checks = [];
    const record = (name, available, detail) => checks.push({ name, available, detail });
    const [major, minor] = process.versions.node.split('.').map(Number);
    record('node', major > 22 || major === 22 && minor >= 13, process.version);
    for (const module of ['pdfjs-dist/legacy/build/pdf.mjs', 'tesseract.js']) {
      try { await dependency(module); record(module, true, 'import successful'); }
      catch (error) { record(module, false, error.message); }
    }
    const poppler = findBinary('pdftoppm');
    record('pdftoppm', Boolean(poppler), poppler);
    for (const lang of String(a.lang || 'rus+kaz').split('+')) {
      const file = path.resolve(a['model-dir'] || ROOT, lang + '.traineddata');
      record(lang + '.traineddata', fs.existsSync(file), file);
    }
    const available = checks.every(c => c.available);
    console.log(JSON.stringify({ parserVersion: VERSION, available, checks }, null, 2));
    if (!available) process.exitCode = 2;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
