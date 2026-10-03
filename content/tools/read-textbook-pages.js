#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { args, readJson, writeJson, resolvePdf, openBook, prepare, legacyCaches, integer } from './lib/textbook-runtime.js';

export async function main(argv = process.argv.slice(2)) {
  const a = args(argv, ['help', 'detect-offset', 'ocr', 'force-ocr', 'progress']);
  if (a.help) {
    console.log('read-textbook-pages.js --pdf FILE|--parsed FILE --pages N-M --out DIR [--pdf-offset N] [--page-numbering pdf] [--visual always|auto|none] [--ocr --lang rus] [--detect-offset]');
    return;
  }
  if (!a.out || (!a.pages && !a['detect-offset'])) throw Error('Required: --out and --pages (or --detect-offset)');
  const pack = a.parsed ? readJson(path.resolve(a.parsed)) : null;
  const book = await openBook(resolvePdf(a.pdf, pack), a['cache-root']);
  try {
    if (pack?.source?.pdf_sha256 && pack.source.pdf_sha256 !== book.pdfHash) throw Error('Parsed JSON belongs to a different PDF.');
    const offset = a['pdf-offset'] != null ? integer(a['pdf-offset'], 'offset', -10000, 10000)
      : (book.book.mapping?.offset ?? pack?.source?.pdf_page_mapping?.offset);
    const physical = a['page-numbering'] === 'pdf' || a['detect-offset'];
    if (!physical && offset == null) throw Error('Printed-page mapping is unknown. Use --detect-offset, then verified --pdf-offset N; or --page-numbering pdf.');
    let requested;
    if (a['detect-offset']) requested = Array.from({ length: Math.min(5, book.document.numPages) }, (_, i) => i + 1);
    else {
      const m = /^(\d+)(?:-(\d+))?$/.exec(a.pages);
      if (!m) throw Error('--pages expects N or N-M');
      const first = integer(m[1], 'first page', 1);
      const last = integer(m[2] ?? first, 'last page', first);
      if (last - first > book.document.numPages) throw Error('Page range exceeds PDF size');
      requested = Array.from({ length: last - first + 1 }, (_, i) => integer(first + i + (physical ? 0 : offset), 'PDF page', 1, book.document.numPages));
    }
    const index = await prepare(book, { pages: requested, visual: a.visual ?? 'always', ocr: a.ocr || a['force-ocr'],
      forceOcr: a['force-ocr'], lang: a.lang, modelDir: a['model-dir'], dpi: a.dpi, workers: a.workers,
      progress: a.progress, legacy: legacyCaches(pack) });
    const outDir = path.resolve(a.out);
    writeJson(path.join(outDir, 'index.json'), index);
    const manifest = { schemaVersion: 2, tool: 'read-textbook-pages', mode: a['detect-offset'] ? 'detect-offset' : 'pages',
      pdfPath: book.pdfPath, pdfSha256: book.pdfHash, pdfOffset: physical ? null : offset,
      mappingVerified: Boolean(book.book.mapping || pack?.source?.pdf_page_mapping), cacheDir: book.dir,
      pages: index.pages.map(p => ({ ...p, bookPage: physical ? null : p.pdfPage - offset,
        readable: p.available, note: 'available/readable means assets exist, not that quotations are verified.' })),
      summary: { requested: requested.length, readable: index.pages.filter(p => p.available).length,
        unreadable: index.pages.filter(p => !p.available).length, allReadable: index.summary.allAvailable,
        allVerified: false }, metrics: index.metrics,
      howToRead: 'Paths point to shared cache. Review critical formulas, quotations and flagged text against PNG. Do not infer accuracy from allReadable.' };
    writeJson(path.join(outDir, 'manifest.json'), manifest);
    console.log(JSON.stringify({ manifest: path.join(outDir, 'manifest.json'), index: path.join(outDir, 'index.json'),
      ...manifest.summary, ...index.metrics }));
    if (!manifest.summary.allReadable) process.exitCode = 2;
  } finally { await book.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
