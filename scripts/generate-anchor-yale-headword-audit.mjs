#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE_PATH = path.join(ROOT, 'editorial', 'old-testament-person-candidates.jsonl');
const AUDIT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-headword-audit.jsonl');
const HEADWORD_PATH = path.join(ROOT, 'editorial', 'anchor-yale-person-headwords.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-headword-audit-report.json');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'anchor-yale-headword-audit.schema.json');
const BASE_URL = 'https://www.theologyandreligiononline.com';
const SOURCE_URL = `${BASE_URL}/custom-browse?docid=AnchorYaleBibleDictionaryPersonList`;
const VALID_DOCIDS = new Set(['b-9780300261875', 'b-9780300261882', 'b-9780300261899', 'b-9780300261905', 'b-9780300261912', 'b-9780300261929']);
const args = process.argv.slice(2);
const captureIndex = args.indexOf('--capture');
const capturePath = captureIndex >= 0 ? path.resolve(args[captureIndex + 1] ?? '') : null;
const apply = args.includes('--apply');

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${path.relative(ROOT, filePath)}:${index + 1}: invalid JSON`); }
  });
}

function normalize(value) {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ḫ/g, 'H').replace(/ḫ/g, 'h')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function validateCapture(capture) {
  if (capture.source_id !== 'source:0009' || capture.count !== capture.rows?.length) throw new Error('invalid capture header');
  if (capture.rows.length !== 1923) throw new Error(`expected 1923 official person headwords, got ${capture.rows.length}`);
  const seen = new Set();
  return capture.rows.map((row, index) => {
    if (!row.article_title?.endsWith('(Person)')) throw new Error(`capture row ${index + 1}: non-person title`);
    const url = new URL(row.locator, BASE_URL);
    const docid = url.searchParams.get('docid');
    const tocid = url.searchParams.get('tocid');
    if (!VALID_DOCIDS.has(docid) || !tocid?.startsWith(`${docid}-`)) throw new Error(`capture row ${index + 1}: invalid locator`);
    const key = `${row.article_title}\u0000${url.href}`;
    if (seen.has(key)) throw new Error(`duplicate person headword: ${row.article_title}`);
    seen.add(key);
    return {source_id:'source:0009', article_title:row.article_title, locator:url.href, volume_docid:docid, source_url:SOURCE_URL};
  });
}

if (apply && !capturePath) throw new Error('--apply requires --capture <path>');
if (!apply && capturePath) throw new Error('--capture is only accepted with --apply');

let headwords;
if (apply) {
  const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
  headwords = validateCapture(capture);
} else {
  headwords = readJsonl(HEADWORD_PATH);
  if (headwords.length !== 1923) throw new Error(`expected 1923 stored headwords, got ${headwords.length}`);
}

const titleMap = new Map();
for (const row of headwords) {
  const baseTitle = row.article_title.replace(/\s*\(Person\)$/, '');
  const key = normalize(baseTitle);
  const matches = titleMap.get(key) ?? [];
  matches.push({article_title:row.article_title, locator:row.locator});
  titleMap.set(key, matches);
}

const candidates = readJsonl(CANDIDATE_PATH);
const names = new Map();
for (const candidate of candidates) {
  const ids = names.get(candidate.latinized) ?? [];
  ids.push(candidate.candidate_id);
  names.set(candidate.latinized, ids);
}

const reviewedAt = '2026-08-30T04:35:00Z';
const audit = [...names.entries()].map(([latinized, candidateIds]) => {
  const matches = titleMap.get(normalize(latinized)) ?? [];
  return {source_id:'source:0009', latinized, candidate_ids:candidateIds, locator_status:matches.length ? 'direct_hit' : 'no_direct_hit', matches, audit_method:'bloomsbury_official_person_list_exact_title', reviewed_at:reviewedAt};
});

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({allErrors:true, strict:true, strictSchema:false, validateSchema:false});
addFormats(ajv);
const validate = ajv.compile(schema);
const errors = [];
const seenCandidates = new Set();
for (const [index, row] of audit.entries()) {
  if (!validate(row)) for (const error of validate.errors ?? []) errors.push(`row ${index + 1}${error.instancePath}: ${error.message}`);
  for (const candidateId of row.candidate_ids) {
    if (seenCandidates.has(candidateId)) errors.push(`duplicate candidate coverage: ${candidateId}`);
    seenCandidates.add(candidateId);
  }
}
if (seenCandidates.size !== candidates.length) errors.push(`candidate coverage incomplete: ${seenCandidates.size}/${candidates.length}`);
if (errors.length) throw new Error(`Anchor Yale headword audit failed (${errors.length}):\n${errors.slice(0,100).join('\n')}`);

const directRows = audit.filter((row) => row.locator_status === 'direct_hit');
const report = {
  generated_at: reviewedAt,
  status: 'completed_locator_audit',
  source_id: 'source:0009',
  official_person_headwords: headwords.length,
  unique_candidate_names: audit.length,
  candidate_coverage: candidates.length,
  direct_name_hits: directRows.length,
  direct_candidate_coverage: directRows.reduce((sum,row)=>sum+row.candidate_ids.length,0),
  no_direct_name_hit: audit.length-directRows.length,
  method: 'official_person_list_exact_normalized_title_match',
  content_boundary: {subscription_required:true, source_text_stored:false, snippets_stored:false}
};

if (apply) {
  fs.writeFileSync(HEADWORD_PATH, headwords.map((row)=>JSON.stringify(row)).join('\n')+'\n');
  fs.writeFileSync(AUDIT_PATH, audit.map((row)=>JSON.stringify(row)).join('\n')+'\n');
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
