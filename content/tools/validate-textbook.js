#!/usr/bin/env node
import path from 'node:path';
import { args, readJson, writeJson } from './lib/textbook-runtime.js';
import { validateParsed } from './lib/textbook-schema.js';
try {
  const a = args(process.argv.slice(2), ['help']);
  if (a.help) console.log('validate-textbook.js --parsed FILE [--out report.json]');
  else {
    if (!a.parsed) throw Error('Required: --parsed');
    const report = validateParsed(readJson(path.resolve(a.parsed)));
    if (a.out) writeJson(path.resolve(a.out), report);
    console.log(JSON.stringify(report));
    if (!report.valid) process.exitCode = 2;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
