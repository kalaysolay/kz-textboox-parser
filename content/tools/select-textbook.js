#!/usr/bin/env node
import path from 'node:path';
import { args, readJson, writeJson, pageNumbers, integer, loadArtifact } from './lib/textbook-runtime.js';

try {
  const a = args(process.argv.slice(2), ['help']);
  if (a.help) {
    console.log('select-textbook.js --index index.json --pages 1-8 [--cursor 0] [--max-chars 16000] [--out packet.json]');
  } else {
    if (!a.index || !a.pages) throw Error('Required: --index and --pages (PDF page numbers)');
    const index = readJson(path.resolve(a.index));
    const requested = pageNumbers(a.pages, index.totalPages);
    const pages = requested.map(n => {
      const entry = index.pages.find(page => page.pdfPage === n);
      if (!entry) throw Error(`PDF page ${n} is not prepared. Run prepare-textbook.js on missing pages.`);
      return entry;
    });
    const blocks = pages.flatMap(entry => loadArtifact(entry).blocks.map(block => ({
      pdfPage: entry.pdfPage, blockId: block.id, text: block.text,
    })));
    const start = integer(a.cursor ?? 0, 'cursor', 0, blocks.length);
    const limit = integer(a['max-chars'] ?? 16000, 'max-chars', 500, 64000);
    let chars = 0;
    let end = start;
    while (end < blocks.length && chars + blocks[end].text.length <= limit) chars += blocks[end++].text.length;
    if (end === start && end < blocks.length) throw Error('One block exceeds --max-chars. Request a larger packet; no text was discarded.');
    const packet = { pdfSha256: index.pdfSha256, numbering: 'PDF', cursor: start,
      nextCursor: end < blocks.length ? end : null, textChars: chars, totalBlocks: blocks.length,
      complete: end === blocks.length,
      pages: pages.map(p => ({ pdfPage: p.pdfPage, pngPath: p.pngPath, source: p.source, quality: p.quality })),
      blocks: blocks.slice(start, end) };
    if (a.out) { writeJson(path.resolve(a.out), packet); console.log(JSON.stringify({ path: path.resolve(a.out), textChars: chars, nextCursor: packet.nextCursor })); }
    else console.log(JSON.stringify(packet));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
