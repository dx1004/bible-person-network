#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const CAPTURE_ARG = process.argv.find((arg) => arg.startsWith('--capture='));
const CAPTURE_PATH = CAPTURE_ARG?.slice('--capture='.length);
const OUTPUT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-toc-page-audit.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-toc-page-audit-report.json');
const HEADWORD_PATH = path.join(ROOT, 'editorial', 'anchor-yale-person-headwords.jsonl');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'anchor-yale-toc-page-audit.schema.json');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readJsonl(file) { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }

let rows;
let reviewedAt;
if (APPLY) {
  if (!CAPTURE_PATH || !fs.existsSync(CAPTURE_PATH)) throw new Error('--apply requires an existing --capture=PATH');
  const capture = readJson(CAPTURE_PATH);
  if (capture.source_text_stored !== false || capture.snippets_stored !== false) throw new Error('restricted-content boundary violated');
  reviewedAt = new Date(capture.captured_at).toISOString();
  rows = capture.rows.map((row) => {
    const pageMatch = row.label.match(/, page (.+)$/);
    if (!pageMatch) throw new Error(`missing page label for ${row.title}`);
    return {
      source_id: 'source:0009',
      article_title: row.title,
      locator: row.locator,
      volume: row.volume,
      page_label: pageMatch[1],
      source_text_stored: false,
      snippets_stored: false,
      reviewed_at: reviewedAt
    };
  });
} else {
  rows = readJsonl(OUTPUT_PATH);
  reviewedAt = rows[0]?.reviewed_at;
}

rows.sort((a, b) => a.locator.localeCompare(b.locator));
const schema = readJson(SCHEMA_PATH);
const ajv = new Ajv({allErrors: true, strict: true, strictSchema: false, validateSchema: false});
addFormats(ajv);
const validate = ajv.compile(schema);
const errors = [];
const locators = new Set();
for (const [index, row] of rows.entries()) {
  if (!validate(row)) for (const error of validate.errors ?? []) errors.push(`row ${index + 1}${error.instancePath}: ${error.message}`);
  if (locators.has(row.locator)) errors.push(`duplicate locator ${row.locator}`);
  locators.add(row.locator);
}
const headwords = readJsonl(HEADWORD_PATH);
const headwordLocators = new Set(headwords.map((row) => row.locator));
for (const locator of headwordLocators) if (!locators.has(locator)) errors.push(`missing TOC locator ${locator}`);
for (const locator of locators) if (!headwordLocators.has(locator)) errors.push(`unexpected TOC locator ${locator}`);
if (rows.length !== 1923 || headwords.length !== 1923) errors.push(`expected 1923 rows, got toc=${rows.length} headwords=${headwords.length}`);
if (errors.length) throw new Error(`Anchor Yale TOC page audit failed (${errors.length}):\n${errors.slice(0, 100).join('\n')}`);

const byVolume = Object.fromEntries([1,2,3,4,5,6].map((volume) => [volume, rows.filter((row) => row.volume === volume).length]));
const report = {generated_at: reviewedAt, status: 'completed', source_id: 'source:0009', official_person_entries: rows.length, by_volume: byVolume, page_locators_complete: true, copyright_boundary: {source_text_stored: false, snippets_stored: false}};
if (APPLY) {
  fs.writeFileSync(OUTPUT_PATH, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
} else {
  const persisted = readJson(REPORT_PATH);
  if (JSON.stringify(persisted) !== JSON.stringify(report)) throw new Error('persisted TOC report differs from regenerated report');
}
console.log(JSON.stringify(report, null, 2));
