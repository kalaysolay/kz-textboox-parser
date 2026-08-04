#!/usr/bin/env node
/**
 * Читает диапазон страниц школьного учебника для роли damulab-textbook-analyst.
 *
 * Живёт в kz-textboox-parser рядом с PDF/parsed (content/tools/), не в приложении Damulab.
 * Источники (по приоритету):
 *   1) кэш OCR/текста парсера (source.extraction_method.ocr_output_dir | text_layer_dir)
 *   2) рендер PNG через pdftoppm (Poppler) — агент читает картинки
 *   3) pdftotext — только если текстовый слой не водяной знак
 *
 * Нумерация: --pages задаёт номера СТРАНИЦ УЧЕБНИКА (как в topics_with_pages).
 * PDF-страница = bookPage + pdfOffset. Offset по умолчанию 0; для книг, где
 * в PDF есть обложка/форзацы перед стр. 1 учебника, задайте --pdf-offset.
 *
 * Usage (из корня этого репо):
 *   node content/tools/read-textbook-pages.js ^
 *     --parsed "Математика/parsed/math_aldamuratova_5grade_part2_parsed_v2.json" ^
 *     --pages 45-50 ^
 *     --out content/runs/_probes/tmp-pages
 *
 *   node content/tools/read-textbook-pages.js --parsed ... --detect-offset --out ...
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    parsed: null,
    pages: null,
    out: null,
    pdfOffset: 0,
    dpi: 150,
    detectOffset: false,
    parserRoot: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) die(`Missing value after ${a}`);
      return v;
    };
    if (a === '--parsed') out.parsed = next();
    else if (a === '--pages') out.pages = next();
    else if (a === '--out') out.out = next();
    else if (a === '--pdf-offset') out.pdfOffset = Number(next());
    else if (a === '--dpi') out.dpi = Number(next()) || 150;
    else if (a === '--parser-root') out.parserRoot = next();
    else if (a === '--detect-offset') out.detectOffset = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node read-textbook-pages.js --parsed <v2.json> --pages <N|N-M> --out <dir> [--pdf-offset N] [--dpi N] [--detect-offset]',
      );
      process.exit(0);
    } else die(`Unknown arg: ${a}`);
  }
  if (!out.parsed) die('Required: --parsed <path-to-parsed-v2.json>');
  if (!out.pages && !out.detectOffset) die('Required: --pages <N|N-M> (or --detect-offset)');
  if (!out.out) die('Required: --out <dir>');
  return out;
}

function parsePageSpec(spec) {
  if (/^\d+$/.test(spec)) {
    const n = Number(spec);
    return [n, n];
  }
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(spec);
  if (!m) die(`Bad --pages: ${spec} (expected N or N-M)`);
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > b) die(`Bad --pages range: ${a}-${b}`);
  return [a, b];
}

function findPopplerBin(name) {
  const which = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true });
  if (which.status === 0) {
    const first = which.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && fs.existsSync(first)) return first;
  }
  return null;
}

function walkPdfs(dir, acc = [], depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'ocr' || e.name === 'tools') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkPdfs(p, acc, depth + 1);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) acc.push(p);
  }
  return acc;
}

function looksLikeRepoRoot(dir) {
  // Признаки корня kz-textboox-parser: предметные папки, tooling парсера или сам пайплайн.
  return (
    fs.existsSync(path.join(dir, 'Математика')) ||
    fs.existsSync(path.join(dir, 'tools', 'pdf-extract')) ||
    fs.existsSync(path.join(dir, 'content', 'tools', 'read-textbook-pages.js'))
  );
}

function resolveParserRoot(parsedPath, explicit) {
  if (explicit) return path.resolve(explicit);
  // Скрипт лежит в content/tools/ → корень репо на два уровня выше.
  const fromScript = path.resolve(__dirname, '../..');
  if (looksLikeRepoRoot(fromScript)) return fromScript;
  let cur = path.dirname(path.resolve(parsedPath));
  for (let i = 0; i < 6; i++) {
    if (looksLikeRepoRoot(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  die('Cannot resolve repo root (kz-textboox-parser); pass --parser-root');
}

function findPdfByFileName(parserRoot, fileName) {
  if (!fileName) return null;
  // 1) рядом с parsed: ../fileName или ../../fileName
  const near = [
    path.join(path.dirname(parserRoot), fileName),
    path.join(parserRoot, fileName),
    path.join(parserRoot, 'Математика', fileName),
    path.join(parserRoot, 'Казахский язык 3 класс', fileName),
    path.join(parserRoot, 'Казахский язык 4 класс', fileName),
    path.join(parserRoot, 'Казахский язык 5 класс', fileName),
  ];
  for (const p of near) {
    if (fs.existsSync(p)) return p;
  }
  const all = walkPdfs(parserRoot);
  const exact = all.filter((p) => path.basename(p) === fileName);
  if (exact.length >= 1) {
    exact.sort((a, b) => a.length - b.length);
    return exact[0];
  }
  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const target = norm(fileName);
  const fuzzy = all.filter((p) => norm(path.basename(p)) === target);
  return fuzzy[0] || null;
}

function resolveCacheDir(parserRoot, source) {
  const em = source?.extraction_method || {};
  const rel = em.ocr_output_dir || em.text_layer_dir || null;
  if (!rel) return { dir: null, kind: null };
  const abs = path.isAbsolute(rel) ? rel : path.join(parserRoot, rel);
  if (!fs.existsSync(abs)) return { dir: null, kind: null, missing: abs };
  const kind = em.ocr_output_dir ? 'ocr_pages' : 'text_layer';
  return { dir: abs, kind };
}

function pageStem(n) {
  return `page_${String(n).padStart(3, '0')}`;
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, dest);
  return true;
}

function isWatermarkOnly(text) {
  if (!text || text.trim().length < 40) return true;
  const t = text.replace(/\s+/g, ' ').toLowerCase();
  const contentLen = text.replace(/\s+/g, '').length;
  if (contentLen < 80 && /okulyk|образовательн/.test(t)) return true;
  const withoutWm = t
    .replace(/все учебники казахстана на okulyk\.kz/g, '')
    .replace(/книга предоставлена исключительно в образовательных целях[\s\S]{0,200}/g, '')
    .trim();
  return withoutWm.length < 60;
}

function extractPdftotext(pdftotextBin, pdfPath, pdfPage, destTxt) {
  const r = spawnSync(
    pdftotextBin,
    ['-f', String(pdfPage), '-l', String(pdfPage), '-layout', '-enc', 'UTF-8', pdfPath, destTxt],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.status !== 0) return { ok: false, error: r.stderr || (r.error && r.error.message) };
  const text = fs.existsSync(destTxt) ? fs.readFileSync(destTxt, 'utf8') : '';
  if (isWatermarkOnly(text)) return { ok: false, watermarkOnly: true, text };
  return { ok: true, text };
}

function renderPdftoppm(pdftoppmBin, pdfPath, pdfPage, destPrefix, dpi) {
  const r = spawnSync(
    pdftoppmBin,
    ['-png', '-r', String(dpi), '-f', String(pdfPage), '-l', String(pdfPage), '-singlefile', pdfPath, destPrefix],
    { encoding: 'utf8', windowsHide: true },
  );
  const png = `${destPrefix}.png`;
  if (r.status !== 0 || !fs.existsSync(png)) {
    return { ok: false, error: r.stderr || (r.error && r.error.message) || `status=${r.status}` };
  }
  return { ok: true, png, bytes: fs.statSync(png).size };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const parsedPath = path.resolve(args.parsed);
  if (!fs.existsSync(parsedPath)) die(`Parsed JSON not found: ${parsedPath}`);

  const pack = JSON.parse(fs.readFileSync(parsedPath, 'utf8'));
  const source = pack.source || {};
  const fileName = source.file_name;
  const parserRoot = resolveParserRoot(parsedPath, args.parserRoot);
  const pdfPath = findPdfByFileName(parserRoot, fileName);
  const cache = resolveCacheDir(parserRoot, source);
  const pdftoppm = findPopplerBin('pdftoppm');
  const pdftotext = findPopplerBin('pdftotext');
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  if (args.detectOffset) {
    if (!pdfPath) die(`PDF not found for file_name=${fileName}`);
    if (!pdftoppm) die('pdftoppm not in PATH (install Poppler)');
    const hint = [];
    for (let p = 1; p <= 5; p++) {
      const prefix = path.join(outDir, `detect_pdf_${String(p).padStart(3, '0')}`);
      const r = renderPdftoppm(pdftoppm, pdfPath, p, prefix, args.dpi);
      hint.push({
        pdfPage: p,
        png: r.ok ? path.basename(r.png) : null,
        note: 'Прочитай печатный номер на PNG; offset = pdfPage - bookPage',
      });
    }
    const manifest = {
      mode: 'detect-offset',
      parsedPath,
      parserRoot,
      pdfPath,
      fileName,
      pages: hint,
      instruction:
        'Открой PNG detect_pdf_00N.png, найди печатный номер (обычно в кружке). ' +
        'Если на PDF-странице N напечатано M, то pdfOffset = N - M. ' +
        'Алдамуратова 5 кл ч.2: PDF 45 = печатная 45 → offset 0.',
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const [bookStart, bookEnd] = parsePageSpec(args.pages);
  const pages = [];
  for (let bookPage = bookStart; bookPage <= bookEnd; bookPage++) {
    const pdfPage = bookPage + args.pdfOffset;
    const stem = pageStem(bookPage);
    const entry = {
      bookPage,
      pdfPage,
      textPath: null,
      pngPath: null,
      source: null,
      readable: false,
      notes: [],
    };

    const cacheStem = pageStem(pdfPage);
    if (cache.dir) {
      const cacheTxt = path.join(cache.dir, `${cacheStem}.txt`);
      const cachePng = path.join(cache.dir, `${cacheStem}.png`);
      const destTxt = path.join(outDir, `${stem}.txt`);
      const destPng = path.join(outDir, `${stem}.png`);
      const gotTxt = copyIfExists(cacheTxt, destTxt);
      const gotPng = copyIfExists(cachePng, destPng);
      if (gotTxt) {
        entry.textPath = destTxt;
        const text = fs.readFileSync(destTxt, 'utf8');
        if (!isWatermarkOnly(text)) {
          entry.readable = true;
          entry.source = cache.kind === 'ocr_pages' ? 'parser_ocr_cache' : 'parser_text_layer';
        } else {
          entry.notes.push('cache text looks like watermark-only');
        }
      }
      if (gotPng) {
        entry.pngPath = destPng;
        if (!entry.readable) {
          entry.readable = true;
          entry.source = entry.source || 'parser_ocr_png';
        }
      }
    }

    if (!entry.readable && pdfPath && pdftotext) {
      const destTxt = path.join(outDir, `${stem}.txt`);
      const r = extractPdftotext(pdftotext, pdfPath, pdfPage, destTxt);
      if (r.ok) {
        entry.textPath = destTxt;
        entry.readable = true;
        entry.source = 'pdftotext';
      } else if (r.watermarkOnly) {
        entry.notes.push('pdftotext: watermark-only text layer');
        try {
          fs.unlinkSync(destTxt);
        } catch (_) {}
      } else {
        entry.notes.push(`pdftotext failed: ${r.error || 'unknown'}`);
      }
    }

    if ((!entry.pngPath || !entry.readable) && pdfPath && pdftoppm) {
      const prefix = path.join(outDir, stem);
      // не перезаписываем уже скопированный PNG из кэша без нужды
      if (!entry.pngPath) {
        const r = renderPdftoppm(pdftoppm, pdfPath, pdfPage, prefix, args.dpi);
        if (r.ok) {
          entry.pngPath = r.png;
          entry.readable = true;
          entry.source = entry.source || 'pdftoppm_render';
        } else {
          entry.notes.push(`pdftoppm failed: ${r.error || 'unknown'}`);
        }
      }
    }

    if (!entry.readable) entry.notes.push('page unreadable: no cache, no text layer, no render');
    pages.push(entry);
  }

  const readableCount = pages.filter((p) => p.readable).length;
  const manifest = {
    schemaVersion: 1,
    tool: 'read-textbook-pages',
    parsedPath,
    parserRoot,
    fileName: fileName || null,
    pdfPath: pdfPath || null,
    pdfOffset: args.pdfOffset,
    bookPageStart: bookStart,
    bookPageEnd: bookEnd,
    cacheDir: cache.dir || null,
    cacheKind: cache.kind || null,
    cacheMissing: cache.missing || null,
    pages: pages.map((p) => ({
      ...p,
      textPath: p.textPath ? path.relative(outDir, p.textPath).replace(/\\/g, '/') : null,
      pngPath: p.pngPath ? path.relative(outDir, p.pngPath).replace(/\\/g, '/') : null,
    })),
    summary: {
      requested: pages.length,
      readable: readableCount,
      unreadable: pages.length - readableCount,
      allReadable: readableCount === pages.length,
    },
    howToRead:
      'Аналитик: сначала открой *.png (Read) и выпиши правила/примеры дословно; ' +
      '*.txt — черновик OCR/слоя, сверяй с PNG. parsed JSON — навигация и перекрёстная проверка.',
  };

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
  if (!manifest.summary.allReadable) process.exit(2);
}

main();
