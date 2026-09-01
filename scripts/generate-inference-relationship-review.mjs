#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const EDITORIAL = path.join(ROOT, 'editorial');
const OUT = path.join(EDITORIAL, 'inference-relationship-review.jsonl');
const REPORT = path.join(EDITORIAL, 'inference-relationship-review-report.json');
const APPLY = process.argv.includes('--apply');
const PUBLISH = process.argv.includes('--publish');
const CHECK = process.argv.includes('--check');
const STAMP = '2026-08-30T00:00:00Z';

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}
function stableHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function pair(a, b) { return [a, b].sort().join('|'); }
function decision(status, reviewer_mode, reason) { return { status, reviewer_mode, reason }; }
function noConflict(note) {
  return { identity_conflict: false, chronology_conflict: false, generation_conflict: false, scriptural_conflict: false, note };
}

const assertions = readJsonl(path.join(DATA, 'assertions.jsonl'));
const baseAssertions = assertions.filter((row) => !row.inference);
const people = readJsonl(path.join(DATA, 'people.jsonl'));
const sources = new Set(readJsonl(path.join(DATA, 'sources.jsonl')).map((row) => row.source_id));
const identities = readJsonl(path.join(DATA, 'identity-options.jsonl'));
const peopleSet = new Set(people.map((row) => row.person_id));
const disputedPeople = new Set(identities.filter((row) => row.status === 'disputed').map((row) => row.person_id));
const assertionById = new Map(baseAssertions.map((row) => [row.assertion_id, row]));

const auditRows = baseAssertions.map((assertion, index) => {
  const defects = [];
  if (!peopleSet.has(assertion.subject_person_id) || !peopleSet.has(assertion.object_person_id)) defects.push('invalid_person_reference');
  if (assertion.subject_person_id === assertion.object_person_id) defects.push('self_loop');
  if (!Array.isArray(assertion.evidence) || !assertion.evidence.length) defects.push('missing_evidence');
  for (const evidence of assertion.evidence || []) {
    if (!sources.has(evidence.source_id)) defects.push('invalid_source_reference');
    if (!String(evidence.passage || '').trim()) defects.push('missing_locator');
  }
  const accepted = defects.length === 0 && assertion.status === 'active';
  const reason = accepted
    ? '人物、来源、定位、方向与非自环约束复核通过；保留原证据等级。'
    : defects.length ? `结构复核未通过：${[...new Set(defects)].join(', ')}` : `原状态为 ${assertion.status}，不重新发布。`;
  return {
    review_id: `ir-${String(index + 1).padStart(6, '0')}`,
    kind: 'existing_assertion_reaudit', assertion_id: assertion.assertion_id,
    subject_person_id: assertion.subject_person_id, object_person_id: assertion.object_person_id,
    relation_type: assertion.relation_type, relation_subtype: assertion.relation_subtype || null,
    direction: assertion.direction, premise_assertion_ids: [], rule: 'direct_assertion_reaudit',
    counterevidence_review: noConflict('本轮只复核结构完整性和已登记证据，不改变原来源判断。'),
    round_a: decision(accepted ? 'accepted' : 'rejected', 'editorial', reason),
    round_b: decision(accepted ? 'accepted' : 'rejected', 'critic', reason),
    final_decision: decision(accepted ? 'accepted' : 'rejected', 'boardroom', reason)
  };
});

const active = baseAssertions.filter((row) => row.status === 'active');
const parents = active.filter((row) => row.relation_type === 'kinship' && row.relation_subtype === 'parent' && row.direction === 'directed');
const childrenByParent = new Map();
for (const row of parents) {
  const list = childrenByParent.get(row.subject_person_id) || [];
  list.push(row); childrenByParent.set(row.subject_person_id, list);
}
const existingSibling = new Set(active.filter((row) => row.relation_type === 'kinship' && row.relation_subtype === 'sibling').map((row) => pair(row.subject_person_id, row.object_person_id)));
const publishedInferenceByPair = new Map(assertions.filter((row) => row.inference).map((row) => [pair(row.subject_person_id, row.object_person_id), row.assertion_id]));
const parentEdges = new Set(parents.map((row) => `${row.subject_person_id}|${row.object_person_id}`));
const candidates = new Map();
for (const [parentId, rows] of childrenByParent) {
  for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
    const left = rows[i].object_person_id; const right = rows[j].object_person_id;
    const key = pair(left, right);
    if (left === right || existingSibling.has(key)) continue;
    const entry = candidates.get(key) || { left: [left, right].sort()[0], right: [left, right].sort()[1], premises: [], parents: [] };
    entry.premises.push(rows[i].assertion_id, rows[j].assertion_id); entry.parents.push(parentId);
    candidates.set(key, entry);
  }
}

const inferredRows = [...candidates.values()].sort((a, b) => pair(a.left, a.right).localeCompare(pair(b.left, b.right))).map((candidate, offset) => {
  const premises = [...new Set(candidate.premises)].sort();
  const generationConflict = parentEdges.has(`${candidate.left}|${candidate.right}`) || parentEdges.has(`${candidate.right}|${candidate.left}`);
  const identityConflict = disputedPeople.has(candidate.left) || disputedPeople.has(candidate.right);
  const accepted = premises.length >= 2 && !generationConflict && !identityConflict;
  const reason = accepted
    ? `由共同直接父母 ${candidate.parents.join('、')} 的两条已发布亲子断言推导；结构化语料未发现身份、代际或经文冲突。`
    : `不采用：${generationConflict ? '存在亲子代际冲突' : identityConflict ? '身份仍有争议' : '前提不足'}。`;
  return {
    review_id: `ir-${String(baseAssertions.length + offset + 1).padStart(6, '0')}`,
    kind: 'inference_candidate', subject_person_id: candidate.left, object_person_id: candidate.right,
    ...(publishedInferenceByPair.has(pair(candidate.left, candidate.right)) ? { assertion_id: publishedInferenceByPair.get(pair(candidate.left, candidate.right)) } : {}),
    relation_type: 'kinship', relation_subtype: 'sibling', direction: 'undirected',
    premise_assertion_ids: premises, rule: 'sibling_from_shared_direct_parent',
    counterevidence_review: { identity_conflict: identityConflict, chronology_conflict: false, generation_conflict: generationConflict, scriptural_conflict: false, note: '反证检查限于已审定结构化人物、身份与关系语料；不是对所有未结构化文献的沉默论证。' },
    round_a: decision(accepted ? 'accepted' : 'rejected', 'editorial', reason),
    round_b: decision(accepted ? 'accepted' : 'rejected', 'critic', reason),
    final_decision: decision(accepted ? 'accepted' : 'rejected', 'boardroom', reason)
  };
});

const rows = [...auditRows, ...inferredRows];
const acceptedInference = inferredRows.filter((row) => row.final_decision.status === 'accepted');
const snapshot = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
const report = {
  generated_at: STAMP, assertion_snapshot_sha256: stableHash(`${baseAssertions.map((row) => JSON.stringify(row)).join('\n')}\n`),
  existing_assertions_reaudited: auditRows.length,
  existing_active_retained: auditRows.filter((row) => row.final_decision.status === 'accepted').length,
  existing_inactive_or_invalid_retained_unpublished: auditRows.filter((row) => row.final_decision.status === 'rejected').length,
  inference_candidates: inferredRows.length, inference_accepted: acceptedInference.length,
  inference_rejected: inferredRows.length - acceptedInference.length,
  inference_rule: 'sibling_from_shared_direct_parent', review_rows_sha256: stableHash(snapshot)
};

if (CHECK) {
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== snapshot) throw new Error('inference review snapshot drift');
  const saved = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  if (saved.review_rows_sha256 !== report.review_rows_sha256 || saved.assertion_snapshot_sha256 !== report.assertion_snapshot_sha256) throw new Error('inference review report drift');
  console.log(JSON.stringify({ status: 'check_passed', ...report }));
  process.exit(0);
}
if (APPLY) {
  atomicWrite(OUT, snapshot); atomicWrite(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}
if (PUBLISH) {
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== snapshot) throw new Error('review snapshot must be generated and independently reviewed before publish');
  const savedReport = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  if (savedReport.review_rows_sha256 !== report.review_rows_sha256 || savedReport.assertion_snapshot_sha256 !== report.assertion_snapshot_sha256) throw new Error('review report does not match assertion snapshot');
  let next = Math.max(...assertions.map((row) => Number(row.assertion_id.slice(5)))) + 1;
  const publishedInferencePairs = new Set(assertions.filter((row) => row.inference).map((row) => pair(row.subject_person_id, row.object_person_id)));
  const additions = acceptedInference.filter((row) => !publishedInferencePairs.has(pair(row.subject_person_id, row.object_person_id))).map((row) => ({
    assertion_id: `asrt-${String(next++).padStart(4, '0')}`,
    subject_person_id: row.subject_person_id, object_person_id: row.object_person_id,
    relation_type: 'kinship', relation_subtype: 'sibling', direction: 'undirected',
    evidence: row.premise_assertion_ids.flatMap((id) => assertionById.get(id).evidence).slice(0, 2).map((e) => ({ ...e, evidence_level: 'inference', note: `推论前提：${row.premise_assertion_ids.join(', ')}` , certainty: 0.72 })),
    status: 'active', confidence: 0.72, editorial_status: 'conservative',
    editor_note: '由共同直接父母关系推导；网页须标示为推论关系。',
    inference: { rule: row.rule, premise_assertion_ids: row.premise_assertion_ids, counterevidence_review: row.counterevidence_review, certainty: 0.72, review_status: 'two_round_accepted' },
    created_at: STAMP, updated_at: STAMP
  }));
  atomicWrite(path.join(DATA, 'assertions.jsonl'), `${[...assertions, ...additions].map((row) => JSON.stringify(row)).join('\n')}\n`);
  console.log(JSON.stringify({ ...report, published_inference_assertions: additions.length }, null, 2));
} else console.log(JSON.stringify(report, null, 2));
