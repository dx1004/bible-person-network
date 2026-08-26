#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const RUN_FILE = path.join(new URL('..', import.meta.url).pathname.replace(/\/$/, ''), 'exports', 'run.json');
const DATA_DIR = path.join(new URL('..', import.meta.url).pathname.replace(/\/$/, ''), 'data');

function readJsonl(filePath, skipEmpty = false) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!skipEmpty) return out;
  return out;
}

function countPendingReview(rows) {
  let chinesePending = 0;
  let relationPending = 0;
  for (const row of rows.assertions) {
    if (row.editorial_status === 'pending') relationPending += 1;
  }
  for (const row of rows.people) {
    if (row?.review_status?.chinese_label_status === 'pending') chinesePending += 1;
  }
  return { chinesePending, relationPending };
}

function reconciliationStatus() {
  const reconPath = path.join(DATA_DIR, 'reconciliation.json');
  if (!fs.existsSync(reconPath)) return 'unknown';
  try {
    const r = JSON.parse(fs.readFileSync(reconPath, 'utf8'));
    if (r?.sblNameExtraction?.status === 'not_implemented') return 'not_implemented';
    if (r?.sblNameExtraction?.status) return r.sblNameExtraction.status;
    if (r?.sbl_person_scan?.method === 'step_lexicon_sbl_token_scan') return 'implemented_limited';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

if (!fs.existsSync(RUN_FILE)) {
  console.log('run.json not found. Execute `npm run validate:data` first.');
  process.exit(0);
}
const run = JSON.parse(fs.readFileSync(RUN_FILE, 'utf8'));
const people = readJsonl(path.join(DATA_DIR, 'people.jsonl')).map((line) => JSON.parse(line));
const assertions = readJsonl(path.join(DATA_DIR, 'assertions.jsonl')).map((line) => JSON.parse(line));
const { chinesePending, relationPending } = countPendingReview({ people, assertions });
const sblNameExtractionStatus = reconciliationStatus();

const needsReview = (
  chinesePending > 0 ||
  relationPending > 0 ||
  sblNameExtractionStatus === 'not_implemented' ||
  sblNameExtractionStatus === 'implemented_limited' ||
  sblNameExtractionStatus === 'unknown'
);

const report = {
  ...run,
  status: needsReview ? 'editorial_review_required' : 'ready',
  summary: [
    `People: ${run.counts.people}`,
    `Name variants: ${run.counts.names}`,
    `Mentions: ${run.counts.mentions}`,
    `Assertions: ${run.counts.assertions}`,
    `Sources: ${run.counts.sources}`,
    `Identity options: ${run.counts.identityOptions}`,
    `Chinese labels pending review: ${chinesePending}`,
    `Relation assertions pending review: ${relationPending}`,
    `SBL proper-name extraction: ${sblNameExtractionStatus}`
  ]
};
const reportPath = path.join(new URL('..', import.meta.url).pathname.replace(/\/$/, ''), 'exports', 'report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
