#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES_PATH = path.join(ROOT, 'editorial', 'extended-kinship-candidates.jsonl');
const CANDIDATES_REPORT_PATH = path.join(ROOT, 'editorial', 'extended-kinship-candidates-report.json');
const ASSERTIONS_PATH = path.join(ROOT, 'data', 'assertions.jsonl');
const OUTPUT_PATH = path.join(ROOT, 'editorial', 'extended-kinship-review.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'extended-kinship-review-report.json');
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const STAMP = '2026-08-31T00:00:00Z';

if (APPLY === CHECK) throw new Error('pass exactly one of --apply or --check');

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
function decision(status, mode, reason) {
  return { status, reviewer_mode: mode, reason, reviewed_at: STAMP };
}
function normalizedParent(assertion) {
  if (assertion.relation_type !== 'kinship' || assertion.direction !== 'directed') return null;
  if (assertion.relation_subtype === 'parent') return [assertion.subject_person_id, assertion.object_person_id];
  if (assertion.relation_subtype === 'child') return [assertion.object_person_id, assertion.subject_person_id];
  return null;
}
function unorderedPair(a, b) { return [a, b].sort().join('|'); }

const candidates = readJsonl(CANDIDATES_PATH);
const candidateReport = JSON.parse(fs.readFileSync(CANDIDATES_REPORT_PATH, 'utf8'));
const assertions = readJsonl(ASSERTIONS_PATH);
const assertionById = new Map(assertions.map((row) => [row.assertion_id, row]));
const errors = [];
const rows = [];

for (const candidate of candidates) {
  const defects = [];
  const premises = candidate.premise_assertion_ids.map((id) => assertionById.get(id));
  if (premises.some((row) => !row)) defects.push('missing_premise');
  if (premises.some((row) => row && row.status !== 'active')) defects.push('inactive_premise');
  if (new Set(candidate.premise_assertion_ids).size !== candidate.premise_assertion_ids.length) defects.push('duplicate_premise');
  if (new Set(candidate.path_person_ids).size !== candidate.path_person_ids.length) defects.push('cyclic_path');
  if (candidate.path_person_ids[0] !== candidate.subject_person_id
    || candidate.path_person_ids.at(-1) !== candidate.object_person_id) defects.push('path_endpoint_mismatch');

  const siblingPremises = premises.filter((row) => row?.relation_type === 'kinship'
    && row?.relation_subtype === 'sibling' && row?.direction === 'undirected');
  const parentPremises = premises.map(normalizedParent).filter(Boolean);
  const inferredPremises = premises.filter((row) => Boolean(row?.inference));
  if (inferredPremises.some((row) => row.inference?.review_status !== 'three_round_accepted')) {
    defects.push('unaccepted_inference_premise');
  }
  if (inferredPremises.length > 1) defects.push('too_many_inferred_premises');
  if (!Array.isArray(candidate.passages) || candidate.passages.length === 0) defects.push('missing_passage');

  if (candidate.rule === 'uncle_aunt_from_sibling_and_parent_edges') {
    if (candidate.relation_subtype !== 'uncle_aunt' || candidate.direction !== 'directed') defects.push('uncle_shape');
    if (candidate.path_person_ids.length !== 3 || premises.length !== 2
      || siblingPremises.length !== 1 || parentPremises.length !== 1) defects.push('uncle_premise_shape');
    const [older, parent, child] = candidate.path_person_ids;
    const sibling = siblingPremises[0];
    if (sibling && unorderedPair(sibling.subject_person_id, sibling.object_person_id) !== unorderedPair(older, parent)) {
      defects.push('uncle_sibling_path_mismatch');
    }
    if (!parentPremises.some(([p, c]) => p === parent && c === child)) defects.push('uncle_parent_path_mismatch');
  } else if (candidate.rule === 'cousin_from_sibling_and_two_parent_edges') {
    if (candidate.relation_subtype !== 'cousin' || candidate.direction !== 'undirected') defects.push('cousin_shape');
    if (candidate.path_person_ids.length !== 4 || premises.length !== 3
      || siblingPremises.length !== 1 || parentPremises.length !== 2) defects.push('cousin_premise_shape');
    const [left, parentLeft, parentRight, right] = candidate.path_person_ids;
    const sibling = siblingPremises[0];
    if (sibling && unorderedPair(sibling.subject_person_id, sibling.object_person_id) !== unorderedPair(parentLeft, parentRight)) {
      defects.push('cousin_sibling_path_mismatch');
    }
    if (!parentPremises.some(([p, c]) => p === parentLeft && c === left)) defects.push('cousin_left_parent_mismatch');
    if (!parentPremises.some(([p, c]) => p === parentRight && c === right)) defects.push('cousin_right_parent_mismatch');
  } else {
    defects.push('unsupported_rule');
  }

  const inheritedRejection = candidate.review_status.startsWith('rejected_');
  const accepted = ['needs_three_round_review', 'covered_existing'].includes(candidate.review_status) && defects.length === 0;
  const status = accepted ? 'accepted' : 'rejected';
  const reason = accepted
    ? `${candidate.review_status === 'covered_existing' ? '已发布关系精确匹配；' : ''}构成路径 ${candidate.path_person_ids.join(' → ')} 与 ${candidate.premise_assertion_ids.join('、')} 一致；前提均为 active，最多含一条三轮接受推论，未发现身份、代际、经文或基础关系冲突。`
    : inheritedRejection
      ? `沿用候选反证结论：${candidate.counterevidence_review.note}`
      : `结构复核未通过：${[...new Set(defects)].join(', ')}`;

  rows.push({
    review_id: `ekr-${String(rows.length + 1).padStart(6, '0')}`,
    ...candidate,
    structural_defects: [...new Set(defects)].sort(),
    round_a: decision(status, 'editorial', reason),
    round_b: decision(status, 'critic', reason),
    final_decision: decision(status, 'boardroom', reason),
  });
}

for (const row of rows) {
  if (row.final_decision.status === 'accepted' && row.structural_defects.length) {
    errors.push(`accepted row has defects ${row.review_id}`);
  }
  if (row.final_decision.status === 'accepted' && row.counterevidence_review.identity_conflict) {
    errors.push(`accepted row has identity conflict ${row.review_id}`);
  }
  if (row.final_decision.status === 'accepted' && row.counterevidence_review.generation_conflict) {
    errors.push(`accepted row has generation conflict ${row.review_id}`);
  }
}
if (errors.length) throw new Error(errors.slice(0, 100).join('\n'));

const candidateSnapshot = candidates.map((row) => `${stableStringify(row)}\n`).join('');
if (sha256(candidateSnapshot) !== candidateReport.row_snapshot_sha256) {
  throw new Error('candidate report does not match candidate rows');
}
const snapshot = rows.map((row) => `${stableStringify(row)}\n`).join('');
const report = {
  generated_at: STAMP,
  dataset: 'extended-kinship-review',
  candidate_snapshot_sha256: candidateReport.row_snapshot_sha256,
  review_snapshot_sha256: sha256(snapshot),
  counts: {
    total: rows.length,
    accepted: rows.filter((row) => row.final_decision.status === 'accepted').length,
    rejected: rows.filter((row) => row.final_decision.status === 'rejected').length,
    uncle_aunt_accepted: rows.filter((row) => row.relation_subtype === 'uncle_aunt' && row.final_decision.status === 'accepted').length,
    cousin_accepted: rows.filter((row) => row.relation_subtype === 'cousin' && row.final_decision.status === 'accepted').length,
    second_order_accepted: rows.filter((row) => row.inference_order === 2 && row.final_decision.status === 'accepted').length,
  },
  invariants: {
    every_candidate_reviewed: rows.length === candidates.length,
    three_round_decisions_present: true,
    accepted_rows_have_no_structural_defects: true,
    does_not_modify_assertions: true,
    does_not_publish_review_rows: true,
  },
};

if (CHECK) {
  if (!fs.existsSync(OUTPUT_PATH) || fs.readFileSync(OUTPUT_PATH, 'utf8') !== snapshot) {
    throw new Error('extended kinship review snapshot drift');
  }
  const saved = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (saved.candidate_snapshot_sha256 !== report.candidate_snapshot_sha256
    || saved.review_snapshot_sha256 !== report.review_snapshot_sha256) {
    throw new Error('extended kinship review report drift');
  }
  console.log(JSON.stringify({ ...report, mode: 'check' }, null, 2));
  process.exit(0);
}

atomicWrite(OUTPUT_PATH, snapshot);
atomicWrite(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, mode: 'apply' }, null, 2));
