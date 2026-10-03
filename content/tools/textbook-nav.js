#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { args, readJson, writeJson, normalizeTopics, integer } from './lib/textbook-runtime.js';

const normalized = value => String(value ?? '').normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const label = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replace(/[\r\n]/g, ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
try {
  const a = args(process.argv.slice(2), ['help']);
  if (a.help) console.log('textbook-nav.js --parsed FILE --out DIR [--topic CODE|ID|TITLE] [--max-chars 16000]');
  else {
    if (!a.parsed || !a.out) throw Error('Required: --parsed and --out');
    const pack = readJson(path.resolve(a.parsed));
    const topics = normalizeTopics(pack);
    const out = path.resolve(a.out);
    const navigation = { schemaVersion: 1, parsedPath: path.resolve(a.parsed), fileName: pack.source?.file_name,
      title: pack.metadata?.title || pack.source?.file_name, topics };
    writeJson(path.join(out, 'toc.json'), navigation);
    const lines = ['# Оглавление учебника', '', `Источник: ${pack.source?.file_name || a.parsed}`, '',
      'Граф показывает только структуру оглавления. Он не заменяет текст учебника.', '', '```mermaid', 'flowchart LR',
      `book["${label(navigation.title)}"]`];
    const groups = new Map();
    for (const [i, topic] of topics.entries()) {
      const parent = topics.findIndex(t => t.id === topic.parentId);
      let parentNode = parent >= 0 ? `t${parent}` : 'book';
      if (parent < 0 && topic.group != null) {
        const key = String(topic.group);
        if (!groups.has(key)) {
          const node = `g${groups.size}`;
          groups.set(key, node);
          lines.push(`${node}["${label(key)}"]`, `book --> ${node}`);
        }
        parentNode = groups.get(key);
      }
      lines.push(`t${i}["${label(topic.title)} · ${topic.pageStart ?? '?'}–${topic.pageEnd ?? '?'}"]`, `${parentNode} --> t${i}`);
    }
    lines.push('```', '', '| Код / ID | Тема | Страницы |', '|---|---|---|');
    for (const topic of topics) lines.push(`| ${topic.code ?? topic.id} | ${topic.title.replaceAll('|', '\\|')} | ${topic.pageStart ?? '?'}–${topic.pageEnd ?? '?'} |`);
    fs.writeFileSync(path.join(out, 'toc.md'), `${lines.join('\n')}\n`, 'utf8');
    let selected = null;
    if (a.topic) {
      const matches = topics.filter(t => [t.id, t.code, t.title].some(v => v != null && normalized(v) === normalized(a.topic)));
      if (matches.length !== 1) throw Error(`Topic has ${matches.length} matches. Use an exact ID/code from toc.json.`);
      const unit = matches[0];
      const raw = pack.topics_with_pages[unit.originalIndex];
      const limit = integer(a['max-chars'] ?? 16000, 'max-chars', 500, 64000);
      const inRange = page => Number.isInteger(page) && page >= unit.pageStart && page <= unit.pageEnd;
      selected = path.join(out, 'topic.json');
      const source = { file_name: pack.source?.file_name, version: pack.source?.version,
        pdf_sha256: pack.source?.pdf_sha256, pdf_page_mapping: pack.source?.pdf_page_mapping,
        extraction_index: pack.source?.extraction_index, extraction_method: pack.source?.extraction_method,
        quality_note: pack.source?.quality_report?.note };
      writeJson(selected, { source, metadata: pack.metadata, unit,
        full_text: raw.full_text?.length <= limit ? raw.full_text : null,
        full_text_status: raw.full_text_status ?? null,
        source_block_refs: raw.source_block_refs ?? [],
        verification: { method: pack.source?.verification?.method,
          block_refs: (pack.source?.verification?.block_refs || []).filter(r => {
            const printed = r.pdf_page - (pack.source?.pdf_page_mapping?.offset ?? 0);
            return inRange(printed);
          }) },
        fullTextOmittedForBudget: Boolean(raw.full_text?.length > limit),
        rules: (pack.rules || []).filter(r => (r.source_pages || [r.source_page]).some(inRange)),
        textbook_tasks: (pack.example_tasks_v2?.textbook_tasks || []).filter(t => String(t.topic_ref) === unit.id || inRange(t.page)),
        structural_examples: (pack.example_tasks_v2?.structural_examples_for_generation || []).filter(e => inRange(e.source_page)),
        generatorProfile: pack.generator_profile_kz_moem });
    }
    console.log(JSON.stringify({ topics: topics.length, toc: path.join(out, 'toc.json'), graph: path.join(out, 'toc.md'), selected }));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
