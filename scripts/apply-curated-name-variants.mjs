#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMES_PATH = path.join(ROOT, 'data', 'names.jsonl');
const PEOPLE_PATH = path.join(ROOT, 'data', 'people.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'curated-name-variants-report.json');
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const STAMP = '2026-08-31T00:00:00Z';

if (APPLY === CHECK) throw new Error('pass exactly one of --apply or --check');

const VARIANTS = [
  {
    name_id: 'name-9145',
    person_id: 'person-000135',
    name_text: '以色列',
    language: 'zh-hans',
    source_scope: 'variant',
    status: 'accepted',
    notes: '雅各受改名后的和合本中文名；创32:28等经文及STEP身份记录明确支持。',
    created_at: STAMP,
    updated_at: STAMP,
  },
  {
    name_id: 'name-9146',
    person_id: 'person-000135',
    name_text: '耶书仑',
    language: 'zh-hans',
    source_scope: 'variant',
    status: 'accepted',
    notes: '和合本用于雅各／以色列的诗体异名；申32:15、33:5、33:26及赛44:2支持。',
    created_at: STAMP,
    updated_at: STAMP,
  },
];

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map(JSON.parse) : [];
}

function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
}

const people = new Map(readJsonl(PEOPLE_PATH).map((row) => [row.person_id, row]));
const names = readJsonl(NAMES_PATH);
const byId = new Map(names.map((row) => [row.name_id, row]));
const byPersonText = new Map(names.map((row) => [`${row.person_id}|${row.language}|${row.name_text}`, row]));

for (const variant of VARIANTS) {
  if (people.get(variant.person_id)?.status !== 'accepted') throw new Error(`target person not accepted: ${variant.person_id}`);
  const idMatch = byId.get(variant.name_id);
  if (idMatch && (idMatch.person_id !== variant.person_id || idMatch.name_text !== variant.name_text)) {
    throw new Error(`name id collision: ${variant.name_id}`);
  }
  const textMatch = byPersonText.get(`${variant.person_id}|${variant.language}|${variant.name_text}`);
  if (textMatch && textMatch.name_id !== variant.name_id) throw new Error(`duplicate curated variant: ${variant.name_text}`);
}

const output = [...names];
for (const variant of VARIANTS) if (!byId.has(variant.name_id)) output.push(variant);
output.sort((a, b) => Number(a.name_id.slice(5)) - Number(b.name_id.slice(5)));

const report = {
  generated_at: STAMP,
  dataset: 'curated-name-variants',
  variant_count: VARIANTS.length,
  name_ids: VARIANTS.map((row) => row.name_id),
  person_ids: [...new Set(VARIANTS.map((row) => row.person_id))],
  invariant: { accepted_people_only: true, stable_ids: true, idempotent: true },
};

if (CHECK) {
  for (const variant of VARIANTS) {
    const row = byId.get(variant.name_id);
    if (!row || JSON.stringify(row) !== JSON.stringify(variant)) throw new Error(`curated variant drift: ${variant.name_id}`);
  }
  const savedReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (JSON.stringify(savedReport) !== JSON.stringify(report)) throw new Error('curated name variant report drift');
  console.log(JSON.stringify({ ...report, mode: 'check' }, null, 2));
  process.exit(0);
}

atomicWrite(NAMES_PATH, `${output.map((row) => JSON.stringify(row)).join('\n')}\n`);
atomicWrite(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, mode: 'apply' }, null, 2));
