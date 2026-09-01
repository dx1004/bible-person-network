#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSERTIONS_PATH = path.join(ROOT, 'data', 'assertions.jsonl');
const PEOPLE_PATH = path.join(ROOT, 'data', 'people.jsonl');
const SOURCES_PATH = path.join(ROOT, 'data', 'sources.jsonl');
const MANIFEST_PATH = path.join(ROOT, 'data', 'manifest.json');
const REVIEW_PATH = path.join(ROOT, 'editorial', 'extended-kinship-review.jsonl');
const REVIEW_REPORT_PATH = path.join(ROOT, 'editorial', 'extended-kinship-review-report.json');
const APPLICATION_REPORT_PATH = path.join(ROOT, 'editorial', 'extended-kinship-application-report.json');
const ASSERTION_SCHEMA_PATH = path.join(ROOT, 'schemas', 'assertions.schema.json');
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const MODE = APPLY ? 'apply' : CHECK ? 'check' : 'preview';

if (APPLY && CHECK) throw new Error('do not pass both --apply and --check');

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
}
function assertionSignature(row) {
  const pair = row.direction === 'undirected'
    ? [row.subject_person_id, row.object_person_id].sort().join('|')
    : `${row.subject_person_id}|${row.object_person_id}`;
  return `${row.relation_type}|${row.relation_subtype || ''}|${row.direction}|${pair}`;
}
function premiseSignature(ids) { return [...ids].sort().join('|'); }
function nextAssertionNumber(assertions) {
  return assertions.reduce((max, row) => {
    const match = /^asrt-(\d+)$/.exec(String(row.assertion_id || ''));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
}

const assertions = readJsonl(ASSERTIONS_PATH);
const people = readJsonl(PEOPLE_PATH);
const sources = readJsonl(SOURCES_PATH);
const reviewRows = readJsonl(REVIEW_PATH);
const reviewReport = JSON.parse(fs.readFileSync(REVIEW_REPORT_PATH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const assertionById = new Map(assertions.map((row) => [row.assertion_id, row]));
const acceptedPeople = new Set(people.filter((row) => row.status === 'accepted').map((row) => row.person_id));
const sourceIds = new Set(sources.map((row) => row.source_id));
const errors = [];

const reviewSnapshot = reviewRows.map((row) => `${stableStringify(row)}\n`).join('');
if (sha256(reviewSnapshot) !== reviewReport.review_snapshot_sha256) {
  errors.push('extended kinship review snapshot mismatch');
}
if (reviewRows.length !== reviewReport.counts?.total) errors.push('extended kinship review count mismatch');

const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
addFormats(ajv);
const validateAssertion = ajv.compile(JSON.parse(fs.readFileSync(ASSERTION_SCHEMA_PATH, 'utf8')));

const activeBySignature = new Map();
for (const assertion of assertions.filter((row) => row.status === 'active')) {
  const key = assertionSignature(assertion);
  const list = activeBySignature.get(key) || [];
  list.push(assertion);
  activeBySignature.set(key, list);
}

let nextNumber = nextAssertionNumber(assertions);
const additions = [];
const alreadyPublished = [];

for (const row of reviewRows.filter((item) => item.final_decision?.status === 'accepted')) {
  const rowErrors = [];
  if (row.structural_defects?.length) rowErrors.push('accepted row has structural defects');
  if (row.counterevidence_review?.identity_conflict
    || row.counterevidence_review?.chronology_conflict
    || row.counterevidence_review?.generation_conflict
    || row.counterevidence_review?.scriptural_conflict) rowErrors.push('accepted row has counterevidence conflict');
  if (!acceptedPeople.has(row.subject_person_id) || !acceptedPeople.has(row.object_person_id)) rowErrors.push('endpoint not accepted');
  if (row.subject_person_id === row.object_person_id) rowErrors.push('self-loop');

  const premises = [];
  for (const premiseId of row.premise_assertion_ids || []) {
    const premise = assertionById.get(premiseId);
    if (!premise) { rowErrors.push(`missing premise ${premiseId}`); continue; }
    if (premise.status !== 'active') rowErrors.push(`inactive premise ${premiseId}`);
    if (!Array.isArray(premise.evidence) || premise.evidence.length === 0) rowErrors.push(`premise without evidence ${premiseId}`);
    premises.push(premise);
  }
  if (new Set(row.premise_assertion_ids || []).size !== (row.premise_assertion_ids || []).length) rowErrors.push('duplicate premise');

  const evidence = [];
  const evidenceKeys = new Set();
  for (const premise of premises) {
    const sourceEvidence = [...(premise.evidence || [])]
      .filter((item) => sourceIds.has(item.source_id) && String(item.passage || '').trim())
      .sort((a, b) => String(a.passage).localeCompare(String(b.passage)) || String(a.source_id).localeCompare(String(b.source_id)))[0];
    if (!sourceEvidence) { rowErrors.push(`no usable evidence ${premise.assertion_id}`); continue; }
    const item = {
      source_id: sourceEvidence.source_id,
      passage: sourceEvidence.passage,
      evidence_level: 'inference',
      note: `扩展亲属推论 ${row.rule}；前提 ${premise.assertion_id}；审核 ${row.review_id}`,
      certainty: row.inference_certainty,
    };
    const key = `${item.source_id}|${item.passage}|${item.note}`;
    if (!evidenceKeys.has(key)) { evidenceKeys.add(key); evidence.push(item); }
  }

  const assertion = {
    assertion_id: `asrt-${String(nextNumber).padStart(4, '0')}`,
    subject_person_id: row.subject_person_id,
    object_person_id: row.object_person_id,
    relation_type: 'kinship',
    relation_subtype: row.relation_subtype,
    direction: row.direction,
    status: 'active',
    confidence: row.inference_certainty,
    editorial_status: 'conservative',
    editor_note: `扩展亲属三轮审核入库：${row.review_id}；反向称谓 ${row.inverse_relation_subtype || 'same'}。`,
    evidence,
    inference: {
      rule: row.rule,
      premise_assertion_ids: row.premise_assertion_ids,
      counterevidence_review: {
        identity_conflict: false,
        chronology_conflict: false,
        generation_conflict: false,
        scriptural_conflict: false,
        note: row.final_decision.reason,
      },
      certainty: row.inference_certainty,
      review_status: 'three_round_accepted',
    },
    created_at: manifest.created_at,
    updated_at: manifest.created_at,
  };

  const existing = activeBySignature.get(assertionSignature(assertion)) || [];
  const exact = existing.find((item) => item.inference?.rule === row.rule
    && premiseSignature(item.inference?.premise_assertion_ids || []) === premiseSignature(row.premise_assertion_ids || []));
  if (exact) { alreadyPublished.push(row.review_id); continue; }
  if (existing.length) rowErrors.push(`same-signature active assertion differs: ${existing.map((item) => item.assertion_id).join(',')}`);
  if (!validateAssertion(assertion)) {
    rowErrors.push((validateAssertion.errors || []).map((error) => `${error.instancePath} ${error.message}`).join('; '));
  }
  if (rowErrors.length) { errors.push(`${row.review_id}: ${rowErrors.join('; ')}`); continue; }
  additions.push(assertion);
  activeBySignature.set(assertionSignature(assertion), [assertion]);
  nextNumber += 1;
}

const report = {
  generated_at: new Date().toISOString(),
  mode: MODE,
  review_rows: reviewRows.length,
  accepted_review_rows: reviewRows.filter((row) => row.final_decision?.status === 'accepted').length,
  rejected_review_rows: reviewRows.filter((row) => row.final_decision?.status === 'rejected').length,
  already_published: alreadyPublished.length,
  would_create: additions.length,
  errors_count: errors.length,
  review_snapshot_sha256: reviewReport.review_snapshot_sha256,
  resulting_assertions: assertions.length + additions.length,
  resulting_active_assertions: assertions.filter((row) => row.status === 'active').length + additions.length,
};

if (errors.length) {
  console.error(JSON.stringify({ ...report, errors: errors.slice(0, 100) }, null, 2));
  process.exit(1);
}

if (CHECK && additions.length) {
  console.error(JSON.stringify({ ...report, error: 'accepted review rows remain unpublished' }, null, 2));
  process.exit(1);
}
if (APPLY && additions.length) {
  atomicWrite(ASSERTIONS_PATH, `${[...assertions, ...additions].map((row) => JSON.stringify(row)).join('\n')}\n`);
}
if (APPLY) atomicWrite(APPLICATION_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
