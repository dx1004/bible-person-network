#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_PATH = path.join(ROOT, 'editorial', 'lexham-headword-locator-audit.jsonl');
const CANDIDATE_PATH = path.join(ROOT, 'editorial', 'old-testament-person-candidates.jsonl');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'lexham-headword-locator-audit.schema.json');
const REQUIRE_COMPLETE = process.argv.includes('--require-complete');

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${path.relative(ROOT, filePath)}:${index + 1}: invalid JSON`); }
  });
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: false, validateSchema: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const audit = readJsonl(AUDIT_PATH);
const candidates = readJsonl(CANDIDATE_PATH);
const candidatesById = new Map(candidates.map((row) => [row.candidate_id, row]));
const expectedNames = new Map();
for (const row of candidates) {
  const ids = expectedNames.get(row.latinized) ?? [];
  ids.push(row.candidate_id);
  expectedNames.set(row.latinized, ids);
}

const errors = [];
const seenNames = new Set();
const seenCandidates = new Set();
const counts = { direct_hit: 0, no_direct_hit: 0, env_error: 0 };
for (const [index, row] of audit.entries()) {
  if (!validate(row)) {
    for (const error of validate.errors ?? []) errors.push(`row ${index + 1}${error.instancePath}: ${error.message}`);
  }
  if (seenNames.has(row.latinized)) errors.push(`duplicate latinized name: ${row.latinized}`);
  seenNames.add(row.latinized);
  counts[row.locator_status] = (counts[row.locator_status] ?? 0) + 1;

  const expectedIds = expectedNames.get(row.latinized) ?? [];
  if (JSON.stringify(row.candidate_ids) !== JSON.stringify(expectedIds)) {
    errors.push(`${row.latinized}: candidate_ids do not match the candidate registry`);
  }
  for (const candidateId of row.candidate_ids) {
    if (!candidatesById.has(candidateId)) errors.push(`${row.latinized}: unknown ${candidateId}`);
    if (seenCandidates.has(candidateId)) errors.push(`duplicate candidate coverage: ${candidateId}`);
    seenCandidates.add(candidateId);
  }
  if (row.locator_status === 'direct_hit') {
    if (!row.article_title || !row.locator?.startsWith('logosres:lbd;art=')) errors.push(`${row.latinized}: direct hit lacks title or Logos locator`);
  } else if (row.article_title !== null || row.locator !== null) {
    errors.push(`${row.latinized}: non-hit must not retain an unrelated article title or locator`);
  }
}

if (REQUIRE_COMPLETE) {
  if (seenNames.size !== expectedNames.size) errors.push(`name coverage incomplete: ${seenNames.size}/${expectedNames.size}`);
  if (seenCandidates.size !== candidates.length) errors.push(`candidate coverage incomplete: ${seenCandidates.size}/${candidates.length}`);
  if (counts.env_error) errors.push(`environment errors remain: ${counts.env_error}`);
}
if (errors.length) throw new Error(`Lexham locator audit failed (${errors.length}):\n${errors.slice(0, 100).join('\n')}`);

console.log(JSON.stringify({
  status: REQUIRE_COMPLETE ? 'complete' : 'in_progress',
  names: { reviewed: seenNames.size, total: expectedNames.size },
  candidates: { reviewed: seenCandidates.size, total: candidates.length },
  counts
}, null, 2));
