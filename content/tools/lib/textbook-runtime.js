import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const VERSION = '1.0.0';
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export const hash = data => crypto.createHash('sha256').update(data).digest('hex');
export const relative = file => path.relative(ROOT, file).replaceAll('\\', '/');
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}
export function args(argv, booleans = []) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--')) throw Error(`Expected --option, got ${argv[i]}`);
    if (booleans.includes(key)) result[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`Missing value for --${key}`);
      result[key] = argv[++i];
    }
  }
  return result;
}
export function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < minimum || n > maximum) throw Error(`Invalid ${label}: ${value}`);
  return n;
}
export function pageNumbers(spec, total) {
  if (!spec || spec === 'all') return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set();
  for (const part of spec.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) throw Error(`Bad page range: ${part}`);
    const first = integer(m[1], 'page', 1, total);
    const last = integer(m[2] ?? m[1], 'page', first, total);
    for (let n = first; n <= last; n++) pages.add(n);
  }
  return [...pages].sort((a, b) => a - b);
}
export async function dependency(specifier) {
  try { return await import(specifier); } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  const candidates = [process.env.KZ_PARSER_NODE_MODULES,
    path.resolve(path.dirname(process.execPath), '../node_modules')].filter(Boolean);
  for (const modules of candidates) {
    const file = path.join(modules, specifier);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return import(pathToFileURL(file).href);
    const pkg = path.join(file, 'package.json');
    if (fs.existsSync(pkg)) return import(pathToFileURL(path.join(file, readJson(pkg).main || 'index.js')).href);
  }
  throw Error(`Missing ${specifier}. Install dependencies in content/tools (see PARSER_GUIDE.md).`);
}
export function findBinary(name) {
  const filename = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [process.env[`KZ_${name.toUpperCase()}`],
    ...String(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, filename)),
    path.resolve(path.dirname(process.execPath), '../../native/poppler/Library/bin', filename)].filter(Boolean);
  return candidates.find(file => fs.existsSync(file)) || null;
}
export function runProcess(command, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(Error(`${path.basename(command)}: ${code}: ${stderr}`)));
  });
}
async function locked(file, fn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let handle;
  const started = Date.now();
  while (handle == null) {
    try {
      handle = fs.openSync(lock, 'wx');
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, started: Date.now() }));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started > 180000) throw Error(`Cache busy: ${lock}. Retry after the other job finishes.`);
      let owner;
      try { owner = readJson(lock); } catch { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
      try { process.kill(owner.pid, 0); } catch (e) {
        if (e.code === 'ESRCH') { fs.unlinkSync(lock); continue; }
      }
      if (Date.now() - started > 180000) throw Error(`Cache busy: ${lock}. Retry after the other job finishes.`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try { return await fn(); } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
}
export function inspectText(text, confidence = null) {
  const compact = text.replace(/\s+/g, ' ');
  const watermark = /Все\s+учебники\s+Казахстана\s+на\s+OKULYK\.KZ/gi;
  const disclaimer = /Книга\s+предоставлена\s+исключительно\s+в\s+образовательных\s+целях\s+согласно\s+Приказа\s+Министра\s+образования\s+и\s+науки\s+Республики\s+Казахстан\s+от\s+17\s+мая\s+2019\s+года\s+№\s*217/gi;
  const cleaned = compact.replace(watermark, '').replace(disclaimer, '').replace(/^[\s*]+/, '').trim();
  const flags = [];
  if (cleaned.replace(/\s/g, '').length < 40) flags.push('short_or_empty_text');
  if (/okulyk\.kz/i.test(compact) && cleaned.replace(/\s/g, '').length < 40) flags.push('watermark_only');
  if (/[\uFFFD\u0000]/u.test(cleaned)) flags.push('damaged_characters');
  if (/(?:[а-яәғқңөұүһі][a-z]|[a-z][а-яәғқңөұүһі])/iu.test(cleaned)) flags.push('mixed_scripts_review');
  if (/[α-ωΑ-Ω√±×÷²³≤≥]/u.test(cleaned)) flags.push('formula_review');
  if (confidence != null && confidence < 85) flags.push('ocr_confidence_review');
  return { candidateUsable: cleaned.replace(/\s/g, '').length >= 40 && !/[\uFFFD\u0000]/u.test(cleaned),
    flags, verified: false, chars: text.length, ocrConfidence: confidence };
}
function blocksFromText(text, pdfPage) {
  let cursor = 0;
  const blocks = [];
  // Keep line boundaries, never merge columns by sorting solely on vertical coordinates.
  for (const line of text.split('\n')) {
    if (line.trim()) blocks.push({ id: `p${pdfPage}.b${blocks.length + 1}`, text: line, start: cursor, end: cursor + line.length });
    cursor += line.length + 1;
  }
  return blocks;
}
export function normalizeTopics(pack) {
  const input = pack.topics_with_pages;
  if (!Array.isArray(input)) throw Error('topics_with_pages must be an array');
  return input.map((topic, i) => ({
    id: String(topic.id ?? topic.topic_code ?? `topic_${i + 1}`),
    code: topic.topic_code ?? topic.paragraph_ref ?? null,
    title: topic.topic_title ?? topic.topic_title_kk ?? topic.title ?? '',
    pageStart: topic.page_start ?? null,
    pageEnd: topic.page_end_estimated ?? (Number.isInteger(input[i + 1]?.page_start) && input[i + 1].page_start > topic.page_start
      ? input[i + 1].page_start - 1 : topic.page_start) ?? null,
    parentId: topic.parent_id == null ? null : String(topic.parent_id),
    level: topic.level ?? 'topic',
    group: topic.section_title ?? topic.section_title_kk ?? topic.unit_title_kk ?? topic.section ?? null,
    fullTextAvailable: Boolean(topic.full_text && topic.full_text_status?.available),
    originalIndex: i,
  }));
}
export function legacyCaches(pack) {
  const em = pack?.source?.extraction_method || {};
  return ['ocr_output_dir', 'text_layer_dir', 'ocr_text_dir', 'ocr_pages_dir'].map(key => ({
    key, dir: em[key] ? path.resolve(ROOT, em[key]) : null,
  })).filter(item => item.dir && fs.existsSync(item.dir));
}
export function resolvePdf(pdf, pack) {
  if (pdf) {
    const exact = path.resolve(pdf);
    if (!fs.existsSync(exact)) throw Error(`Explicit PDF not found: ${exact}`);
    return exact;
  }
  const name = pack?.source?.file_name;
  if (!name) throw Error('Provide --pdf with the exact PDF path.');
  const matches = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === name) matches.push(file);
    }
  }
  walk(path.join(ROOT, 'sources'));
  if (matches.length !== 1) throw Error(`PDF filename has ${matches.length} matches. Provide --pdf explicitly.`);
  return matches[0];
}
export async function openBook(pdfPath, cacheRoot = path.join(ROOT, 'ocr/cache')) {
  const bytes = fs.readFileSync(pdfPath);
  const pdfHash = hash(bytes);
  const pdfjs = await dependency('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0,
    isEvalSupported: false, useSystemFonts: true }).promise;
  const dir = path.join(path.resolve(cacheRoot), pdfHash);
  fs.mkdirSync(dir, { recursive: true });
  const bookFile = path.join(dir, 'book.json');
  const book = fs.existsSync(bookFile) ? readJson(bookFile) : { schemaVersion: 1, pdfSha256: pdfHash,
    totalPages: document.numPages, mapping: null };
  if (!fs.existsSync(bookFile)) writeJson(bookFile, book);
  return { pdfPath, pdfHash, document, dir, book, bookFile, async close() { await document.destroy(); } };
}
export async function setMapping(book, offset, evidence) {
  if (!evidence?.trim()) throw Error('--mapping-evidence is required when saving a page offset.');
  await locked(book.bookFile, async () => {
    const current = readJson(book.bookFile);
    current.mapping = { offset: integer(offset, 'offset', -10000, 10000), evidence, verifiedAt: new Date().toISOString() };
    writeJson(book.bookFile, current);
    book.book = current;
  });
}
async function nativeText(book, pageNumber, stats) {
  const file = path.join(book.dir, `pdfjs-${VERSION}`, `page_${pageNumber}.json`);
  return locked(file, async () => {
    if (fs.existsSync(file)) {
      stats.textHits++;
      const cached = readJson(file);
      return { file, ...cached, quality: inspectText(cached.raw_text) };
    }
    const page = await book.document.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = '';
    const geometry = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str + (item.hasEOL ? '\n' : ' ');
      geometry.push({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height });
    }
    text = text.trimEnd();
    const result = { pdfPage: pageNumber, method: 'pdf_text_layer', raw_text: text,
      blocks: blocksFromText(text, pageNumber), quality: inspectText(text), geometry };
    writeJson(file, result);
    page.cleanup();
    stats.textExtracted++;
    return { file, ...result };
  });
}
async function render(book, pageNumber, dpi, stats) {
  const file = path.join(book.dir, `render-${dpi}-${VERSION}`, `page_${pageNumber}.png`);
  return locked(file, async () => {
    if (fs.existsSync(file) && fs.statSync(file).size > 32 &&
        fs.readFileSync(file).subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
      stats.renderHits++; return file;
    }
    const binary = findBinary('pdftoppm');
    if (!binary) throw Error('pdftoppm not found. Install Poppler or set KZ_PDFTOPPM.');
    const prefix = `${file}.${process.pid}`;
    await runProcess(binary, ['-png', '-r', String(dpi), '-f', String(pageNumber), '-l', String(pageNumber),
      '-singlefile', book.pdfPath, prefix]);
    const png = `${prefix}.png`;
    const signature = fs.readFileSync(png).subarray(0, 8).toString('hex');
    if (signature !== '89504e470d0a1a0a') throw Error(`Invalid PNG for page ${pageNumber}`);
    fs.renameSync(png, file);
    stats.rendered++;
    return file;
  });
}
function modelProfile(languages, modelDir) {
  return languages.map(lang => {
    const file = path.join(modelDir, `${lang}.traineddata`);
    if (!fs.existsSync(file)) throw Error(`OCR model missing: ${file}. Supply local models via --model-dir.`);
    return `${lang}:${hash(fs.readFileSync(file))}`;
  });
}
export async function prepare(book, options = {}) {
  const started = performance.now();
  const pages = options.pages ?? pageNumbers('all', book.document.numPages);
  const workers = integer(options.workers ?? 2, 'workers', 1, 8);
  const dpi = integer(options.dpi ?? 300, 'dpi', 72, 600);
  const psm = integer(options.psm ?? 3, 'PSM', 0, 13);
  if (![3, 4, 6, 7, 11, 13].includes(psm)) throw Error('Supported OCR PSM values: 3, 4, 6, 7, 11, 13.');
  const visual = options.visual ?? 'always';
  if (!['always', 'auto', 'none'].includes(visual)) throw Error('visual must be always, auto or none');
  const stats = { textHits: 0, textExtracted: 0, renderHits: 0, rendered: 0, ocrHits: 0, ocrProcessed: 0, legacyHits: 0 };
  const results = new Array(pages.length);
  const languages = String(options.lang || '').split('+').filter(Boolean);
  const modelDir = path.resolve(options.modelDir || ROOT);
  const profiles = options.ocr && languages.length ? modelProfile(languages, modelDir) : [];
  if (options.ocr && !languages.length) throw Error('OCR needs --lang (for example rus or kaz+rus).');
  const ocrKey = hash(JSON.stringify({ version: VERSION, dpi, languages, profiles, psm })).slice(0, 20);
  let tesseract;
  let cursor = 0;
  const pool = [];
  async function workerLoop() {
    let worker;
    try {
      while (cursor < pages.length) {
        const index = cursor++;
        const pdfPage = pages[index];
        let text = await nativeText(book, pdfPage, stats);
        let png = null;
        // Old caches are hints: no silent promotion to verified data, no import of old render settings.
        if (!text.quality.candidateUsable) {
          for (const cache of options.legacy || []) {
            const candidate = path.join(cache.dir, `page_${String(pdfPage).padStart(3, '0')}.txt`);
            if (!fs.existsSync(candidate)) continue;
            const raw = fs.readFileSync(candidate, 'utf8');
            const quality = inspectText(raw);
            if (quality.candidateUsable) {
              quality.flags.push('legacy_cache_unverified');
              text = { file: candidate, pdfPage, raw_text: raw, method: 'legacy_ocr_cache', quality,
                blocks: blocksFromText(raw, pdfPage) };
              // Store a stable snapshot rather than trusting a mutable legacy path in later jobs.
              const snapshot = path.join(book.dir, 'legacy', `page_${pdfPage}-${hash(raw).slice(0, 16)}.json`);
              writeJson(snapshot, { ...text, file: undefined }); text.file = snapshot;
              stats.legacyHits++;
              break;
            }
          }
        }
        if (options.ocr && (!text.quality.candidateUsable || options.forceOcr)) {
          const file = path.join(book.dir, `ocr-${ocrKey}`, `page_${pdfPage}.json`);
          text = await locked(file, async () => {
            if (fs.existsSync(file)) { stats.ocrHits++; return { file, ...readJson(file) }; }
            png = await render(book, pdfPage, dpi, stats);
            tesseract ??= await dependency('tesseract.js');
            if (!worker) {
              fs.mkdirSync(path.join(book.dir, 'models'), { recursive: true });
              worker = await tesseract.createWorker(languages.join('+'), 1, { langPath: modelDir, gzip: false,
                cachePath: path.join(book.dir, 'models'), errorHandler() {} });
              await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
            }
            const { data } = await worker.recognize(png, {}, { text: true, tsv: true });
            const result = { pdfPage, method: 'tesseract.js', languages, dpi, psm, modelProfile: profiles,
              raw_text: data.text, blocks: blocksFromText(data.text, pdfPage),
              quality: inspectText(data.text, data.confidence) };
            writeJson(file, result);
            if (data.tsv) fs.writeFileSync(file.replace(/\.json$/, '.tsv'), data.tsv, 'utf8');
            stats.ocrProcessed++;
            return { file, ...result };
          });
        }
        if (visual === 'always' || (visual === 'auto' && (text.quality.flags.length || text.method !== 'pdf_text_layer'))) {
          png ??= await render(book, pdfPage, text.method === 'tesseract.js' ? dpi : (options.previewDpi ?? 150), stats);
        }
        results[index] = { pdfPage, textPath: text.file, pngPath: png, source: text.method,
          available: Boolean(png || text.quality.candidateUsable), candidateUsable: text.quality.candidateUsable,
          quality: text.quality, artifactSha256: hash(fs.readFileSync(text.file)), blocks: text.blocks.length,
          chars: text.raw_text.length };
        if (options.progress) process.stderr.write(`pages ${index + 1}/${pages.length}; OCR ${stats.ocrProcessed}; cached ${stats.textHits}\n`);
      }
    } finally { if (worker) await worker.terminate(); }
  }
  for (let i = 0; i < Math.min(workers, pages.length); i++) pool.push(workerLoop());
  const settled = await Promise.allSettled(pool);
  const failure = settled.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const ready = results.filter(page => page.candidateUsable).length;
  return { schemaVersion: 1, parserVersion: VERSION, pdfPath: book.pdfPath, pdfSha256: book.pdfHash,
    totalPages: book.document.numPages, cacheDir: book.dir, mapping: book.book.mapping, pages: results,
    summary: { requested: pages.length, textCandidates: ready, needsReview: results.filter(p => p.quality.flags.length).length,
      allAvailable: results.every(p => p.available), allVerified: false },
    metrics: { ...stats, seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
      llmCalls: 0, llmTokens: 0, note: 'Local preparation only; agent token usage is measured separately.' } };
}
export function loadArtifact(entry) {
  const bytes = fs.readFileSync(entry.textPath);
  if (hash(bytes) !== entry.artifactSha256) throw Error(`Cached text changed for PDF page ${entry.pdfPage}; prepare again.`);
  return JSON.parse(bytes.toString('utf8'));
}
