import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash, writeJson, inspectText, legacyCaches, normalizeTopics, pageNumbers, resolvePdf } from '../lib/textbook-runtime.js';
import { assemble, validateParsed } from '../lib/textbook-schema.js';

test('watermark with arbitrary whitespace is not lesson text', () => {
  const text = 'Все   учебники   Казахстана   на   OKULYK.KZ * Книга   предоставлена   исключительно   в   образовательных   целях\nсогласно   Приказа   Министра   образования   и   науки   Республики   Казахстан   от   17   мая   2019   года   №   217';
  assert.equal(inspectText(text).candidateUsable, false);
  assert.ok(inspectText(text).flags.includes('watermark_only'));
  assert.equal(inspectText(`${text}\nКоординатный луч имеет начало и единичный отрезок. Каждой точке соответствует число.`).candidateUsable, true);
});
test('native short definitions are warnings, not corrupt content', () => {
  assert.deepEqual(pageNumbers('1-3,3,5', 5), [1, 2, 3, 5]);
  assert.throws(() => pageNumbers('0', 5));
  assert.throws(() => pageNumbers('4-2', 5));
  assert.ok(inspectText('ә ғ қ ң ө ұ ү һ і').flags.includes('short_or_empty_text'));
  assert.ok(inspectText('Түсінiк анықтамасы және θ ≤ 5 өрнегі').flags.includes('mixed_scripts_review'));
});
test('legacy cache dialects and title fields are supported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kz-cache-test-'));
  try {
    assert.equal(legacyCaches({ source: { extraction_method: { ocr_text_dir: dir, ocr_pages_dir: dir } } }).length, 2);
    const topics = normalizeTopics({ topics_with_pages: [{ id: 't1', topic_title_kk: 'Тақырып', page_start: 9 }, { id: 't2', topic_title: 'Next', page_start: 12 }] });
    assert.equal(topics[0].pageEnd, 11);
    assert.equal(topics[0].title, 'Тақырып');
    assert.throws(() => resolvePdf(path.join(dir, 'missing.pdf'), { source: { file_name: 'other.pdf' } }));
  } finally { fs.rmSync(dir, { recursive: true }); }
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kz-assemble-test-'));
  const file = path.join(dir, 'page.json');
  const blocks = [{ id: 'p9.b1', text: 'Координатный луч: начало O и единичный отрезок.' }, { id: 'p9.b2', text: 'Вычисли 2 + 2.' }];
  writeJson(file, { raw_text: blocks.map(b => b.text).join('\n'), blocks, languages: ['rus'] });
  const index = { pdfSha256: 'hash', pdfPath: 'book.pdf', parserVersion: '1.0.0', totalPages: 9,
    mapping: { offset: 8, evidence: 'PDF 9 = printed 1' }, cacheDir: dir,
    pages: [{ pdfPage: 9, textPath: file, artifactSha256: hash(fs.readFileSync(file)), blocks: 2, candidateUsable: true, source: 'tesseract.js', quality: { flags: [] } }] };
  const plan = { pdfSha256: 'hash', metadata: { title: 'Book' },
    topics_with_pages: [{ id: 't1', topic_title: 'Тема', page_start: 1, page_end_estimated: 1, block_refs: [{ pdf_page: 9, block_id: 'p9.b1' }] }],
    rules: [{ rule_id: 'r1', block_refs: [{ pdf_page: 9, block_id: 'p9.b1' }] }],
    textbook_tasks: [{ task_id: 'q1', topic_ref: 't1', rubric: 'Задания', task_type: 'calculation', block_refs: [{ pdf_page: 9, block_id: 'p9.b2' }] }],
    verified_block_refs: [{ pdf_page: 9, block_id: 'p9.b1', evidence: 'PNG PDF 9, definition checked' }] };
  return { dir, index, plan, blocks };
}
test('assembly copies exact Unicode, preserves short tasks, and tracks evidence', () => {
  const f = fixture();
  try {
    const pack = assemble(f.index, f.plan);
    assert.equal(pack.topics_with_pages[0].full_text, f.blocks[0].text);
    assert.equal(pack.rules[0].statement, f.blocks[0].text);
    assert.equal(pack.example_tasks_v2.textbook_tasks[0].question_text, f.blocks[1].text);
    assert.equal(pack.example_tasks_v2.textbook_tasks[0].needs_manual_check, true);
    assert.equal(pack.topics_with_pages[0].full_text_status.verified, true);
    assert.equal(validateParsed(pack).valid, true);
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});
test('assembly rejects missing coverage, stale artifacts, unknown blocks and wrong PDFs', () => {
  const f = fixture();
  try {
    assert.throws(() => assemble(f.index, { ...f.plan, pdfSha256: 'other' }), /different PDF/);
    assert.throws(() => assemble(f.index, { ...f.plan, textbook_tasks: [] }), /Unassigned/);
    assert.throws(() => assemble(f.index, { ...f.plan, verified_block_refs: [{ pdf_page: 9, block_id: 'fake' }] }), /Unknown block/);
    fs.appendFileSync(f.index.pages[0].textPath, ' ');
    assert.throws(() => assemble(f.index, f.plan), /Cached text changed/);
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});
test('partial block selections cannot hide unassigned suffixes', () => {
  const f = fixture();
  try {
    const plan = { ...f.plan, rules: [], topics_with_pages: [{ ...f.plan.topics_with_pages[0], block_refs: [{ pdf_page: 9, block_id: 'p9.b1', start: 0, end: 10 }] }] };
    assert.throws(() => assemble(f.index, plan), /Unassigned/);
    plan.ignored_blocks = [{ pdf_page: 9, block_id: 'p9.b1', start: 10, end: f.blocks[0].text.length, reason: 'Navigation fragment outside lesson' }];
    assert.equal(assemble(f.index, plan).topics_with_pages[0].full_text, f.blocks[0].text.slice(0, 10));
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});

test('evidence-backed corrections preserve the raw cache and reject mismatched originals', () => {
  const f = fixture();
  try {
    const original = fs.readFileSync(f.index.pages[0].textPath, 'utf8');
    const correction = { pdf_page: 9, block_id: 'p9.b1', original_text: f.blocks[0].text,
      corrected_text: 'Координатный луч: начало O, единичный отрезок.', evidence: 'PNG PDF 9, definition checked' };
    const pack = assemble(f.index, { ...f.plan, text_corrections: [correction] });
    assert.equal(pack.rules[0].statement, correction.corrected_text);
    assert.equal(fs.readFileSync(f.index.pages[0].textPath, 'utf8'), original);
    assert.throws(() => assemble(f.index, { ...f.plan, text_corrections: [{ ...correction, original_text: 'wrong' }] }), /does not match/);
    assert.throws(() => assemble(f.index, { ...f.plan, text_corrections: [{ ...correction, evidence: '' }] }), /visual evidence/);
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});

test('cyclic hierarchy is rejected and an unchecked answer cannot be high confidence', () => {
  const f = fixture();
  try {
    const cyclic = assemble(f.index, f.plan);
    cyclic.topics_with_pages[0].parent_id = 't1';
    assert.equal(validateParsed(cyclic).valid, false);
    f.plan.textbook_tasks[0].answer_block_refs = [{ pdf_page: 9, block_id: 'p9.b1' }];
    f.plan.verified_block_refs = [{ pdf_page: 9, block_id: 'p9.b2', evidence: 'PNG PDF 9, question checked' }];
    assert.equal(assemble(f.index, f.plan).example_tasks_v2.textbook_tasks[0].confidence, 'medium');
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});

test('compact ranges copy every block and reject reversed or missing boundaries', () => {
  const f = fixture();
  try {
    const range = { pdf_page: 9, from_block: 'p9.b1', to_block: 'p9.b2', evidence: 'PNG PDF 9, both lines checked' };
    f.plan.topics_with_pages[0].block_refs = [range];
    f.plan.verified_block_refs = [range];
    const pack = assemble(f.index, f.plan);
    assert.equal(pack.topics_with_pages[0].full_text, f.blocks.map(b => b.text).join('\n'));
    assert.equal(pack.example_tasks_v2.textbook_tasks[0].confidence, 'high');
    f.plan.topics_with_pages[0].block_refs = [{ ...range, from_block: 'p9.b2', to_block: 'p9.b1' }];
    assert.throws(() => assemble(f.index, f.plan), /Invalid block range/);
    f.plan.topics_with_pages[0].block_refs = [{ ...range, to_block: 'missing' }];
    assert.throws(() => assemble(f.index, f.plan), /Invalid block range/);
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});

test('CLI packets resume without losing text; assemble, validate and graph work together', () => {
  const f = fixture();
  try {
    const tools = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const run = (file, ...args) => {
      const result = spawnSync(process.execPath, [path.join(tools, file), ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return JSON.parse(result.stdout);
    };
    f.blocks[0].text = f.blocks[0].text.repeat(8);
    f.blocks[1].text = f.blocks[1].text.repeat(20);
    writeJson(f.index.pages[0].textPath, { blocks: f.blocks, raw_text: f.blocks.map(b => b.text).join('\n') });
    f.index.pages[0].artifactSha256 = hash(fs.readFileSync(f.index.pages[0].textPath));
    const indexFile = path.join(f.dir, 'index.json');
    const planFile = path.join(f.dir, 'plan.json');
    const parsedFile = path.join(f.dir, 'parsed.json');
    writeJson(indexFile, f.index); writeJson(planFile, f.plan);
    const first = run('select-textbook.js', '--index', indexFile, '--pages', '9', '--max-chars', '500');
    assert.notEqual(first.nextCursor, null);
    const collected = [...first.blocks];
    if (first.nextCursor != null) collected.push(...run('select-textbook.js', '--index', indexFile, '--pages', '9', '--cursor', String(first.nextCursor), '--max-chars', '500').blocks);
    assert.deepEqual(collected.map(b => b.text), f.blocks.map(b => b.text));
    run('assemble-textbook.js', '--index', indexFile, '--plan', planFile, '--out', parsedFile);
    assert.equal(run('validate-textbook.js', '--parsed', parsedFile).valid, true);
    const nav = run('textbook-nav.js', '--parsed', parsedFile, '--topic', 't1', '--out', path.join(f.dir, 'nav'));
    assert.ok(fs.readFileSync(nav.graph, 'utf8').includes('flowchart LR'));
    assert.equal(JSON.parse(fs.readFileSync(nav.selected, 'utf8')).unit.id, 't1');
    const duplicate = spawnSync(process.execPath, [path.join(tools, 'assemble-textbook.js'), '--index', indexFile, '--plan', planFile, '--out', parsedFile], { encoding: 'utf8' });
    assert.notEqual(duplicate.status, 0, 'Existing output must not be overwritten implicitly');
    for (const reader of ['read-textbook-pages.js', 'read-textbook-pages.cjs']) {
      assert.equal(spawnSync(process.execPath, [path.join(tools, reader), '--help'], { encoding: 'utf8' }).status, 0);
    }
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});
