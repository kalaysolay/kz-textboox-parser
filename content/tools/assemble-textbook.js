#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { args, readJson, writeJson } from './lib/textbook-runtime.js';
import { assemble } from './lib/textbook-schema.js';
try {
  const a = args(process.argv.slice(2), ['help', 'overwrite']);
  if (a.help) console.log('assemble-textbook.js --index index.json --plan structure.json --out parsed_v3.json [--overwrite]');
  else {
    if (!a.index || !a.plan || !a.out) throw Error('Required: --index, --plan, --out');
    if (fs.existsSync(a.out) && !a.overwrite) throw Error('Output exists; choose a new path or explicitly use --overwrite.');
    const index = readJson(path.resolve(a.index));
    const plan = readJson(path.resolve(a.plan));
    const pack = assemble(index, { ...plan, extraction_index: path.resolve(a.index) });
    writeJson(path.resolve(a.out), pack);
    console.log(JSON.stringify({ output: path.resolve(a.out), topics: pack.topics_with_pages.length,
      rules: pack.rules.length, tasks: pack.example_tasks_v2.textbook_tasks.length,
      completeBook: pack.source.coverage.complete_book, qualityNote: pack.source.quality_report.note }));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
