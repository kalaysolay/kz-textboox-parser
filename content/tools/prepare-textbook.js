#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { args, openBook, prepare, readJson, resolvePdf, legacyCaches, pageNumbers, setMapping, writeJson } from './lib/textbook-runtime.js';

export async function main(argv = process.argv.slice(2)) {
  const a = args(argv, ['help', 'ocr', 'force-ocr', 'progress']);
  if (a.help) { console.log('prepare-textbook.js --pdf FILE --out DIR [--pages all|1-5,9] [--ocr --lang rus|kaz+rus] [--visual always|auto|none] [--workers 2] [--dpi 300] [--model-dir DIR] [--set-offset N --mapping-evidence TEXT]'); return; }
  if (!a.out) throw Error('Required: --out DIR');
  const pack = a.parsed ? readJson(path.resolve(a.parsed)) : null;
  const book = await openBook(resolvePdf(a.pdf, pack), a['cache-root']);
  try {
    if (a['set-offset'] != null) await setMapping(book, a['set-offset'], a['mapping-evidence']);
    const index = await prepare(book, { pages: pageNumbers(a.pages, book.document.numPages), ocr: Boolean(a.ocr || a['force-ocr']),
      forceOcr: a['force-ocr'], lang: a.lang, modelDir: a['model-dir'], psm: a.psm, dpi: a.dpi,
      visual: a.visual, workers: a.workers, legacy: legacyCaches(pack), progress: a.progress });
    const file = path.resolve(a.out, 'index.json');
    writeJson(file, index);
    writeJson(path.resolve(a.out, `metrics-${Date.now()}.json`), index.metrics);
    console.log(JSON.stringify({ index: file, ...index.summary, ...index.metrics }));
    if (!index.summary.allAvailable) process.exitCode = 2;
  } finally { await book.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
